const fs = require('node:fs')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const {
  prepareShare,
  sliceBody,
  submitMaterial,
  mediaPath,
  framePath,
  removeMaterialFiles,
  desktopWindowRoute,
} = require('./materials.cjs')
const {
  advanceWindowSpan,
  migrateWindowSlice,
  minDwellMs,
} = require('./window-spans.cjs')
const { BrowserBridge } = require('./browser-bridge.cjs')
const { canSample, observeFrame, finishFrames } = require('./representative-frames.cjs')
const { saveHistoryFile } = require('./history.cjs')
const { ChatHistory } = require('./chat-history.cjs')
const { notificationPath, pageRoute, validatePage, deliverPending } = require('./notifications.cjs')
const initialProfileMarkdown = require('./profile-template.json')
const captureVersion = 5

function read(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

function save(file, value) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 })
  fs.renameSync(file + '.tmp', file)
}

function recordWindow(profile, sample, at) {
  const history = profile.history
  const previous = history.windowSpan
  const { active, candidate, finished } = advanceWindowSpan(
    previous,
    profile.windowCandidate,
    sample,
    at,
  )
  if (finished) {
    const frames = finishFrames(profile, previous, finished.occurred_at,
      () => save(profile.file, history))
    history.materials.push({
      id: finished.event_id,
      kind: 'perception',
      body: finished,
      source: 'window',
      label: '前台停留',
      ...(frames.length && { frames }),
    })
  }
  history.windowSpan = active
  profile.windowCandidate = candidate
  return finished
}

// A pre-upgrade screenshot can be recovered only if its original dwell is still queued.
function attachQueuedScreenshots(history, images, mediaDirectory) {
  const owners = new Map(history.materials
    .filter(item => item.source === 'window' && item.body?.state_key === 'desktop.window_span')
    .map(item => [item.id, item]))
  if (history.windowSpan) owners.set(history.windowSpan.id, history.windowSpan)
  const unused = []
  for (const image of images) {
    const owner = owners.get(image.context?.activity_id)
    const file = framePath({ mediaDirectory }, image.id)
    const span = owner?.body?.value ?? owner
    const start = Date.parse(span?.started_at ?? span?.start)
    const end = Date.parse(span?.ended_at ?? span?.awaySince ?? span?.lastSeen)
    const at = Date.parse(image.at)
    const bytes = fs.statSync(file, { throwIfNoEntry: false })?.size
    const frames = owner?.frames ?? []
    // Old JPEGs can be 4 MiB each. Keep the combined JSON within the existing proxy limit.
    const totalBytes = frames.reduce((sum, frame) => sum + frame.bytes, 0)
    if (owner && start <= at && at <= end && bytes > 0 && frames.length < 4 &&
        totalBytes + bytes <= 5 * 1024 * 1024) {
      frames.push({ id: image.id, occurred_at: image.at, window_title: image.context.title, bytes })
      owner.frames = frames.sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
    } else unused.push(file)
  }
  return unused
}

function migrateCaptureSettings(dir, configFile, settings) {
  // Each server/terminal has its own offline queue. Remove obsolete observations
  // before starting any network workers, including queues for inactive terminals.
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!name.isFile() || !/^terminal-[0-9a-f]{64}\.json$/.test(name.name))
      continue
    const file = path.join(dir, name.name)
    let history
    try {
      history = read(file, null)
    } catch (error) {
      if (error instanceof SyntaxError) continue
      throw error
    }
    if (!history) continue
    let changed = Object.hasOwn(history, 'lastAgenda')
    delete history.lastAgenda
    // v3 used this queue exclusively for live desktop.activity observations.
    // Completed spans and explicit shares have their own durable materials queue.
    for (const field of ['pending', 'lastObserved', 'lastSent']) {
      if (Object.hasOwn(history, field)) {
        delete history[field]
        changed = true
      }
    }
    if (history.lastMaterial?.label === '日历安排') {
      delete history.lastMaterial
      changed = true
    }
    if (history.materials) {
      const retained = history.materials.filter(
        (item) =>
          item.source !== 'calendar' &&
          item.body?.state_key !== 'desktop.calendar',
      )
      if (retained.length !== history.materials.length) changed = true
      history.materials = retained.map((item) => {
        if (item.source !== 'window' || item.kind !== 'slice') return item
        changed = true
        return migrateWindowSlice(item)
      })
    }
    const oldImages = history.materials?.filter(item => item.source === 'screenshot') ?? []
    if (oldImages.length) {
      const mediaDirectory = path.join(dir, 'media-' + path.parse(name.name).name.slice('terminal-'.length))
      const unused = attachQueuedScreenshots(history, oldImages, mediaDirectory)
      history.materials = history.materials.filter(item => item.source !== 'screenshot')
      save(file, history)
      for (const file of unused) fs.rmSync(file, { force: true })
    } else if (changed) save(file, history)
  }
  delete settings.calendarFile
  delete settings.calendarSecret
  delete settings.windowTitles
  settings.captureVersion = captureVersion
  save(configFile, settings)
}

function connection(url, terminal) {
  const service = new URL(url)
  if (
    !['http:', 'https:'].includes(service.protocol) ||
    service.username ||
    service.password ||
    service.search ||
    service.hash ||
    service.pathname !== '/'
  )
    throw new Error('请输入服务根地址')
  if (
    typeof terminal !== 'string' ||
    !terminal.trim() ||
    /[\r\n]/.test(terminal)
  )
    throw new Error('终端 ID 无效')
  return { url: service.origin, terminal: terminal.trim() }
}

async function fetchResponse(profile, route, options) {
  const response = await fetch(profile.url + route, {
    ...options,
    redirect: 'error',
    headers: {
      Authorization: 'Bearer ' + profile.token,
      'X-Terminal-ID': profile.terminal,
      ...options.headers,
    },
  })
  if (!response.ok) {
    const info = await response.json().catch(() => ({}))
    const code =
      typeof info.error === 'string' && /^[a-z_]{1,64}$/.test(info.error)
        ? ' · ' + info.error
        : ''
    const error = new Error('HTTP ' + response.status + code)
    error.status = response.status
    error.code = info.error
    throw error
  }
  return response
}

async function request(profile, route, body, signal, binaryHeaders) {
  // The compound receipt is issued after the vision model processes up to four frames.
  const timeout = AbortSignal.timeout(route === desktopWindowRoute ? 600000 : binaryHeaders ? 60000 : 8000)
  const response = await fetchResponse(profile, route, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      binaryHeaders ??
      (body === undefined ? {} : { 'Content-Type': 'application/json' }),
    body: binaryHeaders ? body : JSON.stringify(body),
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  })
  return response.json()
}

class DesktopAgent {
  constructor(dir, secure, sample, notify, screenshot, presentNotifications) {
    this.dir = dir
    this.secure = secure
    this.sample = sample
    this.presentNotifications = presentNotifications
    this.screenshot = screenshot
    this.notify = notify
    fs.mkdirSync(dir, { recursive: true })
    this.configFile = path.join(dir, 'agent-settings.json')
    const settings = read(this.configFile, {
      url: 'http://127.0.0.1:8080',
      terminal: 'http-desktop',
    })
    if (settings.captureVersion !== captureVersion)
      migrateCaptureSettings(dir, this.configFile, settings)
    this.appearance = ['light', 'dark'].includes(settings.appearance)
      ? settings.appearance
      : 'system'
    let token = ''
    try {
      if (settings.secret)
        token = secure.decryptString(Buffer.from(settings.secret, 'base64'))
    } catch {
      /* The system keyring may have changed. Ask for the token again. */
    }
    this.open(settings, token)
    this.pollTimer = setInterval(() => this.sync(), 2200)
    if (presentNotifications) this.notificationTimer = setInterval(() => this.pollNotifications(), 5000)
    this.captureTimer = setInterval(() => this.capture(), 15000)
    this.sync()
    this.capture()
  }

  open(settings, token) {
    this.finishWindow()
    if (this.profile?.bridge) void this.profile.bridge.stop()
    this.profile?.controller.abort()
    this.profile?.captureController.abort()
    const key = createHash('sha256')
      .update(settings.url + '\n' + settings.terminal)
      .digest('hex')
    const file = path.join(this.dir, 'terminal-' + key + '.json')
    this.profile = {
      ...settings,
      revision: (this.profile?.revision ?? 0) + 1,
      token,
      file,
      mediaDirectory: path.join(this.dir, 'media-' + key),
      controller: new AbortController(),
      captureController: new AbortController(),
      issue: '',
      sampleIssue: '',
      history: read(file, {}),
      chat: new ChatHistory(),
    }
    const p = this.profile
    // Old clients persisted a complete local transcript. Keep outstanding sends
    // so they can still be retried; committed history is loaded from the server.
    if (Array.isArray(p.history.messages)) {
      p.history.outbox = p.history.messages.filter(m => m.role === 'user' &&
        ['queued', 'unsent', 'waiting'].includes(m.status))
      delete p.history.messages
      save(file, p.history)
    }
    p.history.outbox ??= []
    p.history.materials ??= []
    p.screenshotsEnabled = !!(p.collecting && p.screenshotsEnabled)
    p.screenshotMinutes = [1, 5, 15].includes(p.screenshotMinutes)
      ? p.screenshotMinutes
      : 5
    p.screenshotEpoch = 0
    p.nextScreenshot = 0
    if (!p.screenshotsEnabled && (p.history.windowSpan?.frames?.length ||
        p.history.materials.some(item => item.source === 'screenshot' || item.frames?.length))) {
      this.dropAutomatic(p, 'screenshot')
      save(p.file, p.history)
    }
    // A crash between saving the JPEG and committing its queue entry can leave an orphan.
    const directory = path.join(p.mediaDirectory, 'periodic')
    if (fs.existsSync(directory)) {
      const queued = new Set((p.history.windowSpan?.frames || []).map(frame => frame.id))
      for (const item of p.history.materials) {
        if (item.source === 'screenshot') queued.add(item.id)
        for (const frame of item.frames || []) queued.add(frame.id)
      }
      for (const id of fs.readdirSync(directory))
        if (/^[0-9a-f-]{36}$/.test(id) && !queued.has(id))
          fs.rmSync(path.join(directory, id), { force: true })
    }
    p.history.processing ??= []
    p.history.browserReceipts ??= []
    if (
      !p.collecting &&
      (p.history.windowSpan ||
        p.history.materials.some((item) => item.source === 'window'))
    ) {
      this.clearActivity(p)
      save(p.file, p.history)
    } else if (p.history.windowSpan) {
      // After an unclean exit we only know the window up to its last sample.
      const end =
        p.history.windowSpan.awaySince || p.history.windowSpan.lastSeen
      recordWindow(p, null, new Date(end))
      save(p.file, p.history)
    }
    p.bridge = new BrowserBridge({
      onCapture: (event) => this.browserCapture(p, event),
    })
    if (p.browserSecret && p.token) this.restoreBridge(p)
  }

  state() {
    const p = this.profile
    return {
      url: p.url,
      terminal: p.terminal,
      connectionRevision: p.revision,
      appearance: this.appearance,
      configured: !!p.token,
      collecting: !!p.collecting,
      screenshotsEnabled: !!p.screenshotsEnabled,
      screenshotMinutes: p.screenshotMinutes,
      screenshotIssue: p.screenshotIssue || '',
      browserEnabled: !!p.browserSecret,
      browserIssue: p.browserIssue || '',
      pendingMaterials: p.history.materials.length,
      materialIssue: p.materialIssue || '',
      lastMaterial: p.history.lastMaterial || null,
      failedMaterial:
        p.history.materials.find((item) => item.error)?.id || null,
      processing: p.history.processing.length,
      processingIssue: p.processingIssue || '',
      issue: p.issue,
      sampleIssue: p.sampleIssue,
      lastSpan: p.history.lastSpan ?? null,
      messages: this.chatMessages(p),
      hasEarlier: p.chat.hasEarlier,
    }
  }

  chatMessages(p) {
    const pending = new Map(p.history.outbox.map(row => [row.id, row]))
    const byEvent = new Map(p.history.outbox.filter(m => m.eventId).map(m => [m.eventId, m]))
    const messages = p.chat.messages.map(row => {
      if (row.role !== 'user') return row
      const local = byEvent.get(row.id) || (row.terminal === p.terminal && pending.get(row.messageId))
      if (!local) return row
      pending.delete(local.id)
      return { ...row, id: local.id, status: local.status, error: local.error }
    })
    return messages.concat([...pending.values()].filter(m => ['queued', 'unsent'].includes(m.status)))
  }

  async loadEarlier() {
    const p = this.profile
    if (!p.token) return
    const get = route => request(p, route, undefined, p.controller.signal)
    await p.chat.read(get, true)
    if (p === this.profile && !p.controller.signal.aborted) this.publish()
  }

  publish() {
    this.notify(this.state())
  }
  persist(p) {
    if (p !== this.profile || p.controller.signal.aborted)
      throw new Error('连接已更改')
    save(p.file, p.history)
    this.publish()
  }

  async configure({ url, terminal, token }) {
    const dest = connection(url, terminal)
    const old = this.profile
    const same = old.url === dest.url && old.terminal === dest.terminal
    const credential = token?.trim() || (same && old.token)
    if (!credential) throw new Error('请输入终端令牌')
    await request({ ...dest, token: credential }, '/v1/outputs?limit=1')
    if (this.profile !== old) throw new Error('连接已更改，请重试')
    const secret = this.secure.encryptString(credential).toString('base64')
    const settings = {
      ...(same ? this.settings(old) : {}),
      ...dest,
      captureVersion,
      secret,
      collecting: same && !!old.collecting,
      appearance: this.appearance,
    }
    save(this.configFile, settings)
    if (same && old.token === credential) Object.assign(old, settings)
    else {
      if (same && old.token) {
        old.history.outbox = []
        save(old.file, old.history)
      }
      this.open(settings, credential)
    }
    this.publish()
    this.sync()
    this.capture()
  }

  async userProfile() {
    const p = this.profile
    if (!p.token) throw new Error('请先连接终端')
    try {
      const doc = await request(p, '/v1/profile', undefined, p.controller.signal)
      if (p !== this.profile || p.controller.signal.aborted) throw new Error('连接已更改')
      if (!['ready', 'empty', 'unconfigured'].includes(doc?.status) ||
          typeof doc.markdown !== 'string' ||
          (doc.effective !== undefined && typeof doc.effective !== 'boolean') ||
          (doc.effective === true && doc.status !== 'ready') ||
          (doc.status === 'ready' && !doc.markdown.trim()))
        throw new Error('后端返回的用户档案格式无效')
      if (doc.status === 'unconfigured')
        return { status: 'unconfigured', markdown: '', effective: false }
      if (doc.status === 'empty') {
        const markdown = doc.markdown.trim() ? doc.markdown : initialProfileMarkdown
        return { status: 'empty', markdown, effective: false }
      }
      return { status: 'ready', markdown: doc.markdown, effective: doc.effective ?? null }
    } catch (error) {
      if (p !== this.profile || p.controller.signal.aborted) throw new Error('连接已更改')
      if (error.status === 404) throw new Error('当前后端不支持用户档案，请更新后端。')
      if (error instanceof SyntaxError) throw new Error('后端返回的用户档案格式无效')
      throw error
    }
  }

  apiKeys() {
    return this.requestApiKeys()
  }

  async updateApiKey(options) {
    if (this.profile.revision !== options?.connectionRevision)
      throw new Error('连接已更改，请重新打开接口密钥')
    if (typeof options.id !== 'string' || !options.id ||
        typeof options.apiKey !== 'string' || !/^[!-~]{1,4096}$/.test(options.apiKey) ||
        /\s/.test(options.apiKey))
      throw new Error('请输入有效的接口密钥')
    return this.requestApiKeys({ id: options.id, api_key: options.apiKey })
  }

  async requestApiKeys(body) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接终端')
    const { protocol, hostname } = new URL(p.url)
    const local = hostname === 'localhost' || hostname === '[::1]' ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname)
    if (protocol !== 'https:' && !(protocol === 'http:' && local))
      throw new Error('管理接口密钥需要 HTTPS 或本机连接')

    let page
    try {
      page = await request(p, '/v1/settings/api-keys', body, p.controller.signal)
    } catch (error) {
      if (p !== this.profile || p.controller.signal.aborted)
        throw new Error('连接已更改，请重新打开接口密钥')
      if (error.code === 'secure_transport_required')
        throw new Error('管理接口密钥需要 HTTPS 或本机连接')
      if (error.status === 401) throw new Error('终端令牌无效，请重新连接')
      if (error.status === 403) throw new Error('此终端没有管理接口密钥的权限')
      if (error.status === 404 && error.code === 'unknown_key_id')
        throw new Error('密钥配置项已变更，请刷新')
      if ([404, 405].includes(error.status))
        throw new Error('当前后端不支持接口密钥管理，请更新后端')
      if (error.status === 400) throw new Error('请输入有效的接口密钥')
      if (error.status === 503) throw new Error('后端暂时无法读写接口密钥')
      if (error instanceof SyntaxError) throw new Error('后端返回的密钥设置格式无效')
      if (!error.status) throw new Error('无法连接后端，请检查连接后重试')
      throw new Error('管理接口密钥失败，请刷新后重试')
    }
    if (p !== this.profile || p.controller.signal.aborted)
      throw new Error('连接已更改，请重新打开接口密钥')
    if (!Array.isArray(page?.items) || !page.items.every(item =>
      typeof item?.id === 'string' && item.id &&
      Array.isArray(item.usages) && item.usages.every(label => typeof label === 'string') &&
      typeof item.configured === 'boolean' &&
      (item.configured
        ? typeof item.masked === 'string' && /^••••(?:[!-~]{4})?$/u.test(item.masked)
        : item.masked === null)))
      throw new Error('后端返回的密钥设置格式无效')
    return page.items.map(({ id, usages, configured, masked }) => ({ id, usages, configured, masked }))
  }

  async notificationPage(cursor) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接终端')
    try {
      const page = await request(p, pageRoute(cursor), undefined, p.controller.signal)
      if (p !== this.profile) throw new Error('连接已更改')
      return validatePage(page)
    } catch (error) {
      if (error.status === 404) throw new Error('当前后端尚未提供设备通知。')
      throw error
    }
  }

  readNotification(id) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接终端')
    return request(p, notificationPath(id) + '/read', {}, p.controller.signal)
  }

  downloadNotificationFile({notificationId, file}, choosePath) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接终端')
    const route = notificationPath(notificationId) + '/files/'
    return saveHistoryFile(file, choosePath, id => {
      if (p !== this.profile || p.controller.signal.aborted) throw new Error('连接已更改')
      return fetchResponse(p, route + encodeURIComponent(id), {
        signal: AbortSignal.any([p.controller.signal, AbortSignal.timeout(300000)]),
      })
    })
  }

  async pollNotifications() {
    const p = this.profile
    if (!p.token || !this.presentNotifications || p.pollingNotifications ||
        Date.now() < (p.nextNotificationsPoll ?? 0) || p.controller.signal.aborted) return
    p.pollingNotifications = true
    try {
      await deliverPending({
        request: (route, body) => request(p, route, body, p.controller.signal),
        inFlight: p.history.notificationReceipts ??= [],
        save: () => this.persist(p),
        present: items => this.presentNotifications(items, p),
        active: () => p === this.profile && !p.controller.signal.aborted,
      })
    } catch (error) {
      // A legacy server or a temporary failure in this inbox must not block chat.
      p.nextNotificationsPoll = Date.now() + (error.status === 404 ? 60000 : 10000)
    } finally {
      p.pollingNotifications = false
    }
  }

  async schedule({ start, end, cursor }) {
    const profile = this.profile
    if (!profile.token) throw new Error('请先连接终端')
    const isInstant = (value) =>
      typeof value === 'string' &&
      /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
      Number.isFinite(Date.parse(value))
    if (
      !isInstant(start) ||
      !isInstant(end) ||
      Date.parse(start) >= Date.parse(end)
    )
      throw new Error('无效的日历时间范围')
    const query = new URLSearchParams({ start, end, limit: '100' })
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || !cursor || cursor.length > 2048)
        throw new Error('无效的日历分页位置')
      query.set('cursor', cursor)
    }
    try {
      const page = await request(
        profile,
        '/v1/schedule?' + query,
        undefined,
        profile.controller.signal,
      )
      if (profile !== this.profile) throw new Error('连接已更改')
      if (
        !Array.isArray(page?.items) ||
        !(page.next_cursor === null || typeof page.next_cursor === 'string') ||
        !page.items.every(
          (item) =>
            typeof item?.id === 'string' &&
            typeof item.title === 'string' &&
            typeof item.action === 'string' &&
            (item.content == null || typeof item.content === 'string') &&
            isInstant(item.trigger_at) &&
            ['scheduled', 'triggered'].includes(item.status),
        )
      )
        throw new Error('日历数据格式有误，请检查后端版本。')
      return page
    } catch (error) {
      if (error.status === 404)
        throw new Error('当前后端未提供日历，请升级后端后刷新。')
      throw error
    }
  }

  async history({ view, cursor, groupId }) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接终端')
    if (
      ![
        'conversation',
        'notification',
        'perception',
        'slice',
        'chat',
        'timeline',
      ].includes(view)
    )
      throw new Error('未知的历史视图')
    const query = new URLSearchParams({ limit: '40' })
    if (cursor != null) {
      if (typeof cursor !== 'string' || !cursor || cursor.length > 2048)
        throw new Error('无效的历史分页位置')
      query.set('cursor', cursor)
    }
    const get = (route) => request(p, route, undefined, p.controller.signal)
    if (groupId !== undefined) {
      if (
        view !== 'slice' ||
        typeof groupId !== 'string' ||
        !/^[\w:-]{1,256}$/.test(groupId)
      )
        throw new Error('无效的截图活动')
      return get(
        '/v1/history/screenshot-groups/' +
          encodeURIComponent(groupId) +
          '?' +
          query,
      )
    }
    query.set('view', view)
    if (view === 'slice') {
      query.set('grouped', '1')
      try {
        return await get('/v1/history?' + query)
      } catch (error) {
        if (error.status !== 400 || error.code !== 'invalid_query') throw error
        query.delete('grouped')
      }
    }
    return get('/v1/history?' + query)
  }

  async compression({ kind, layer, id, activity, cursor }) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接终端')
    const query = new URLSearchParams({ limit: '40' })
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || !cursor || cursor.length > 2048)
        throw new Error('无效的分页位置')
      query.set('cursor', cursor)
    }
    let path = '/v1/history/compression'
    if (kind === 'list' && ['perception', 'slice'].includes(layer)) {
      query.set('layer', layer)
    } else if (kind === 'source' || kind === 'batch') {
      if (
        typeof id !== 'string' ||
        !id ||
        id.length > 512 ||
        /[\\/]/.test(id) ||
        Array.from(id).some((ch) => ch.charCodeAt(0) < 32) ||
        id === '..' ||
        id === '.'
      )
        throw new Error('无效的记录编号')
      if (kind === 'source') {
        path += '/sources'
        if (activity === true) query.set('activity', '1')
      }
      path += '/' + encodeURIComponent(id)
    } else {
      throw new Error('未知的压缩记录类型')
    }
    try {
      return await request(
        p,
        path + '?' + query,
        undefined,
        p.controller.signal,
      )
    } catch (error) {
      if (error.status === 404)
        throw new Error(
          kind === 'list'
            ? '当前后端未提供压缩对照，请升级后端后刷新。'
            : '找不到这条记录。如使用旧后端，请升级后再查看详情。',
        )
      throw error
    }
  }

  downloadHistoryFile(file, choosePath) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接终端')
    const token = p.token
    return saveHistoryFile(file, choosePath, (id) => {
      if (p !== this.profile || p.token !== token)
        throw new Error('连接已更改，请重新打开记忆')
      return fetchResponse(p, '/v1/history/files/' + encodeURIComponent(id), {
        signal: AbortSignal.any([
          p.controller.signal,
          AbortSignal.timeout(300000),
        ]),
      })
    })
  }

  settings(p = this.profile) {
    return {
      url: p.url,
      terminal: p.terminal,
      secret: p.secret,
      collecting: !!p.collecting,
      screenshotsEnabled: !!p.screenshotsEnabled,
      screenshotMinutes: p.screenshotMinutes,
      appearance: this.appearance,
      captureVersion,
      browserSecret: p.browserSecret || null,
    }
  }

  savePreferences(changes) {
    save(this.configFile, { ...this.settings(), ...changes })
  }

  setAppearance(appearance) {
    if (!['system', 'light', 'dark'].includes(appearance))
      throw new Error('无效的外观选项')
    this.savePreferences({ appearance })
    this.appearance = appearance
    this.publish()
  }

  setCollection(enabled) {
    const p = this.profile
    if (!p.token || typeof enabled !== 'boolean')
      throw new Error('请先连接终端')
    this.savePreferences({
      collecting: enabled,
      screenshotsEnabled: enabled && !!p.screenshotsEnabled,
    })
    p.collecting = enabled
    p.captureController.abort()
    p.captureController = new AbortController()
    p.sampleIssue = ''
    if (!enabled) {
      p.screenshotsEnabled = false
      p.screenshotEpoch++
      p.screenshotIssue = ''
      this.dropAutomatic(p, 'screenshot')
      this.clearActivity(p)
    }
    this.persist(p)
    if (enabled) this.capture()
  }

  setScreenshots({ enabled, minutes }) {
    const p = this.profile
    if (
      !p.token ||
      typeof enabled !== 'boolean' ||
      ![1, 5, 15].includes(minutes)
    )
      throw new Error('截图设置无效')
    if (enabled && (!p.collecting || !this.screenshot))
      throw new Error('请先开启桌面活动采集')
    this.savePreferences({
      screenshotsEnabled: enabled,
      screenshotMinutes: minutes,
    })
    p.screenshotsEnabled = enabled
    p.screenshotMinutes = minutes
    p.nextScreenshot = 0
    p.screenshotEpoch++
    p.screenshotIssue = ''
    if (!enabled) this.dropAutomatic(p, 'screenshot')
    this.persist(p)
  }

  finishWindow() {
    const p = this.profile
    clearTimeout(p?.dwellTimer)
    if (!p?.history.windowSpan || p.controller.signal.aborted) return
    recordWindow(p, null, new Date())
    this.persist(p)
  }

  clearActivity(p) {
    clearTimeout(p.dwellTimer)
    p.windowCandidate = null
    this.dropAutomatic(p, 'window')
    p.history.windowSpan = null
  }

  // Remove queued observations when their source is disconnected. Explicit shares survive.
  dropAutomatic(p, source) {
    if (p.uploading?.source === source) p.uploadController?.abort()
    const removed = []
    if (source === 'screenshot') {
      p.frameProbe = null
      if (p.history.windowSpan?.frames) {
        removed.push(...p.history.windowSpan.frames)
        delete p.history.windowSpan.frames
      }
    }
    for (const item of p.history.materials) {
      if (item.frames && (source === 'screenshot' || item.source === source)) {
        if (p.uploading === item) p.uploadController?.abort()
        removed.push(...item.frames)
        delete item.frames
        // A revoked attachment or old endpoint error must not block the dwell.
        item.attempts = 0
        item.rejected = false
        item.retryAt = 0
        item.error = ''
      }
      if (item.source === source && !item.body)
        fs.rmSync(mediaPath(p, item), { force: true })
    }
    p.history.materials = p.history.materials.filter(
      (item) => item.source !== source,
    )
    p.materialIssue =
      p.history.materials.find((item) => item.error)?.error || ''
    if (removed.length) {
      save(p.file, p.history)
      for (const frame of removed) fs.rmSync(framePath(p, frame.id), { force: true })
    }
  }

  addMaterial(p, item) {
    if (p !== this.profile || !p.token || p.controller.signal.aborted)
      throw new Error('请先连接终端')
    p.history.materials.push(item)
  }

  shareMaterial(material) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接终端')
    const item = prepareShare(material, p.mediaDirectory)
    this.addMaterial(p, item)
    this.persist(p)
    void this.flushMaterials(p)
  }

  async flushMaterials(p = this.profile) {
    if (p.flushing || !p.token || p.controller.signal.aborted) return
    p.flushing = true
    try {
      // Keep each perception source ordered while allowing unrelated uploads to proceed.
      const waitingKeys = new Set()
      for (const item of [...p.history.materials]) {
        if (p.controller.signal.aborted) return
        if (!p.history.materials.includes(item)) continue
        const key = item.kind === 'perception' ? item.body.state_key : null
        if (key && waitingKeys.has(key)) continue
        if (item.retryAt > Date.now() || item.rejected) {
          if (key) waitingKeys.add(key)
          continue
        }
        p.uploading = item
        p.uploadController = new AbortController()
        try {
          const receipt = await submitMaterial(
            p,
            item,
            request,
            p.uploadController.signal,
          )
          if (!p.history.materials.includes(item)) continue
          if (!item.body && receipt.event_id && !p.controller.signal.aborted)
            p.history.processing.push({
              id: receipt.event_id,
              kind: item.kind,
              label: item.label,
            })
        } catch (uploadError) {
          if (p.controller.signal.aborted) return
          if (p.uploadController.signal.aborted || !p.history.materials.includes(item)) continue
          let error = uploadError
          // An older server can reject the new shape after accepting this
          // exact v2 slice. Only an explicit duplicate receipt confirms that.
          let oldReceipt = false
          if (
            item.legacyWindowText &&
            !item.frames?.length &&
            error.status === 409 &&
            error.code === 'event_id_conflict'
          ) {
            try {
              const receipt = await request(
                p,
                '/v1/slices',
                {
                  event_id: item.body.event_id,
                  occurred_at: item.body.occurred_at,
                  text: item.legacyWindowText,
                },
                p.uploadController.signal,
              )
              oldReceipt = receipt.duplicate === true
            } catch (retryError) {
              error = retryError
            }
            if (p.controller.signal.aborted) return
            if (!p.history.materials.includes(item)) continue
          }
          if (!oldReceipt) {
            if (key) waitingKeys.add(key)
            item.error = item.frames?.length && error.status === 404
              ? '当前后端尚未支持带图感知。已暂存，升级后将重试。'
              : error.message
            item.rejected =
              [400, 409, 413, 415, 422].includes(error.status) ||
              error.code === 'ENOENT'
            item.attempts = (item.attempts || 0) + 1
            item.retryAt =
              Date.now() +
              Math.min(300000, 2000 * 2 ** Math.min(item.attempts, 8))
            p.materialIssue = item.label + ' · ' + item.error
            this.persist(p)
            continue
          }
        }
        if (p.controller.signal.aborted) return
        p.history.materials = p.history.materials.filter(
          (entry) => entry !== item,
        )
        p.history.lastMaterial = {
          label: item.label,
          at: new Date().toISOString(),
        }
        if (
          item.source === 'window' &&
          item.body?.state_key === 'desktop.window_span'
        ) {
          p.history.lastSpan = item.body.value
        }
        p.materialIssue =
          p.history.materials.find((entry) => entry.error)?.error || ''
        this.persist(p)
        removeMaterialFiles(p, item)
      }
      await this.checkProcessing(p)
    } catch (error) {
      if (!p.controller.signal.aborted) {
        p.materialIssue = error.message
        this.publish()
      }
    } finally {
      p.flushing = false
      p.uploading = null
    }
  }

  async checkProcessing(p) {
    if ((p.nextStatusCheck || 0) > Date.now()) return
    p.nextStatusCheck = Date.now() + 15000
    let issue = ''
    for (const entry of [...p.history.processing]) {
      if (p.controller.signal.aborted) return
      try {
        const result = await request(
          p,
          '/v1/' + entry.kind + '/slices/' + encodeURIComponent(entry.id),
          undefined,
          p.controller.signal,
        )
        if (p.controller.signal.aborted) return
        if (result.status === 'completed') {
          p.history.processing = p.history.processing.filter(
            (other) => other !== entry,
          )
          this.persist(p)
        } else if (result.status === 'retrying')
          issue = entry.label + ' · 后端处理失败，将自动重试'
      } catch (error) {
        if (p.controller.signal.aborted) return
        issue = entry.label + ' · 处理状态暂时不可用'
        if (error.status === 404) {
          p.history.processing = p.history.processing.filter(
            (other) => other !== entry,
          )
          this.persist(p)
        }
      }
    }
    if (p.processingIssue !== issue) {
      p.processingIssue = issue
      this.publish()
    }
  }

  manageFailed({ id, retry }) {
    const p = this.profile
    const item = p.history.materials.find(
      (entry) => entry.id === id && entry.error,
    )
    if (!item || p.uploading === item) return
    if (retry === true) {
      delete item.error
      delete item.rejected
      item.retryAt = 0
    } else if (retry === false) {
      p.history.materials = p.history.materials.filter(
        (entry) => entry !== item,
      )
    } else throw new Error('操作无效')
    p.materialIssue =
      p.history.materials.find((entry) => entry.error)?.error || ''
    this.persist(p)
    if (retry === false) removeMaterialFiles(p, item)
    void this.flushMaterials(p)
  }

  async restoreBridge(p) {
    try {
      const code = this.secure.decryptString(
        Buffer.from(p.browserSecret, 'base64'),
      )
      await p.bridge.start(code)
    } catch {
      p.browserIssue = '浏览器连接未启动，请关闭后重新配对。'
      if (p === this.profile) this.publish()
    }
  }

  async setBrowser(enabled) {
    const p = this.profile
    if (!p.token || typeof enabled !== 'boolean')
      throw new Error('请先连接终端')
    if (p.browserChanging) throw new Error('正在更改浏览器连接')
    p.browserChanging = true
    try {
      if (!enabled) {
        p.browserSecret = null
        this.dropAutomatic(p, 'browser')
        this.savePreferences({ browserSecret: null })
        await p.bridge.stop()
      } else if (!p.browserSecret) {
        const code = await p.bridge.start()
        if (p !== this.profile) {
          await p.bridge.stop()
          return
        }
        p.browserSecret = this.secure.encryptString(code).toString('base64')
        this.savePreferences({ browserSecret: p.browserSecret })
      }
      p.browserIssue = ''
      if (p === this.profile) this.persist(p)
    } finally {
      p.browserChanging = false
    }
  }

  pairingCode() {
    const p = this.profile
    if (!p.browserSecret) throw new Error('请先启用浏览器接入')
    return this.secure.decryptString(Buffer.from(p.browserSecret, 'base64'))
  }

  browserCapture(p, event) {
    if (!p.browserSecret || p !== this.profile) throw new Error('浏览器未连接')
    if (p.history.browserReceipts.includes(event.event_id)) return
    const auto = event.kind === 'page'
    const body = auto
      ? {
          event_id: event.event_id,
          occurred_at: event.occurred_at,
          state_key: 'browser.page',
          value: event.value,
        }
      : sliceBody(event.text, event.occurred_at, event.event_id)
    this.addMaterial(p, {
      id: body.event_id,
      kind: auto ? 'perception' : 'slice',
      body,
      source: auto ? 'browser' : 'shared',
      label: auto ? '浏览器页面' : '浏览器分享',
    })
    p.history.browserReceipts = [
      ...p.history.browserReceipts.slice(-255),
      body.event_id,
    ]
    this.persist(p)
    void this.flushMaterials(p)
  }

  send(text) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接终端')
    if (typeof text !== 'string' || !text.trim())
      throw new Error('消息不能为空')
    p.history.outbox.push({
      id: randomUUID(),
      role: 'user',
      text: text.trim(),
      at: new Date().toISOString(),
      status: 'queued',
    })
    this.persist(p)
    this.sync()
  }

  retry(id) {
    const p = this.profile
    const m = p.history.outbox.find(
      (row) => row.id === id && row.role === 'user',
    )
    if (!m || !p.token) return
    if (['failed', 'interrupted', 'missing'].includes(m.status))
      return this.send(m.text)
    if (m.status !== 'unsent') return
    m.status = 'queued'
    delete m.error
    this.persist(p)
    this.sync()
  }

  async sync() {
    const p = this.profile
    if (!p.token || p.syncing || p.controller.signal.aborted) return
    void this.flushMaterials(p)
    p.syncing = true
    const api = (route, body) => request(p, route, body, p.controller.signal)
    try {
      for (const m of p.history.outbox.filter(
        (row) => row.status === 'queued',
      )) {
        try {
          const receipt = await api('/v1/messages', {
            message_id: m.id,
            text: m.text,
          })
          if (typeof receipt.job_id !== 'string')
            throw new Error('服务端返回的任务 ID 无效')
          m.eventId = receipt.event_id
          m.job = receipt.job_id
          m.status = 'waiting'
        } catch (error) {
          if (p.controller.signal.aborted) return
          m.status = 'unsent'
          m.error = error.message
        }
        this.persist(p)
      }

      // Inbox acknowledgements and job tracking must not prevent an independent
      // notification reply or a server reset from becoming visible in chat.
      const results = await Promise.allSettled([
        this.syncDelivery(p, api),
        p.chat.read(api).then(changed => {
          if (p.controller.signal.aborted) return
          // The POST may have reached the server even if its receipt was lost.
          const accepted = new Set(p.chat.messages.filter(row => row.terminal === p.terminal && row.messageId).map(row => row.messageId))
          const keep = p.history.outbox.filter(m => m.status !== 'unsent' || !accepted.has(m.id))
          if (keep.length !== p.history.outbox.length) {
            p.history.outbox = keep
            this.persist(p)
          } else if (changed) this.publish()
        }),
      ])
      for (const result of results)
        if (result.status === 'rejected') throw result.reason
      if (p.issue) {
        p.issue = ''
        this.publish()
      }
    } catch (error) {
      if (!p.controller.signal.aborted && p.issue !== error.message) {
        p.issue = error.message
        this.publish()
      }
    } finally {
      p.syncing = false
    }
  }

  async syncDelivery(p, api) {
    const inbox = await api('/v1/outputs?limit=100')
    for (const output of inbox.outputs)
      if (output.status !== 'delivered')
        await api('/v1/outputs/' + encodeURIComponent(output.output_id) + '/ack', {})
    for (const m of p.history.outbox.filter(row => row.status === 'waiting')) {
      let job
      try {
        job = await api('/v1/jobs/' + encodeURIComponent(m.job))
      } catch (error) {
        if (error.status !== 404) throw error
      }
      if (p.controller.signal.aborted) return
      if (!job || job.status === 'completed') {
        p.history.outbox = p.history.outbox.filter(row => row !== m)
        this.persist(p)
      } else if (job.status === 'failed' || job.status === 'interrupted') {
        m.status = job.status
        m.eventId ||= job.event_id
        this.persist(p)
      }
    }
  }

  async captureScreenshot(p, target, value, signal) {
    const span = p.history.windowSpan
    if (
      !p.screenshotsEnabled ||
      !target ||
      target.pid === process.pid ||
      !span ||
      span.pendingObject ||
      p.windowCandidate ||
      value.activity !== 'active' ||
      !canSample(p, span)
    )
      return
    const epoch = p.screenshotEpoch
    const valid = () =>
      !signal.aborted && p === this.profile && epoch === p.screenshotEpoch &&
      p.history.windowSpan?.id === span.id
    // Probe at most once per regular poll. Budget is spent only on selected pictures.
    p.nextScreenshot = Date.now() + 15000
    try {
      const occurredAt = span.lastSeen
      const { jpegBase64, signature } = await this.screenshot(target)
      if (!valid()) return
      const after = await this.sample(true)
      if (
        !valid() ||
        after.activity !== 'active' ||
        after.target?.id !== target.id ||
        after.target?.pid !== target.pid ||
        after.foreground_app !== value.foreground_app ||
        after.window_title !== value.window_title
      )
        return
      const title = span.workObjects?.at(-1)?.window_title || value.window_title
      observeFrame(p, span, { jpegBase64, signature, at: occurredAt, title },
        () => save(p.file, p.history))
      if (p.screenshotIssue) {
        p.screenshotIssue = ''
        this.publish()
      }
    } catch (error) {
      if (valid() && p.screenshotIssue !== error.message) {
        p.screenshotIssue = error.message
        this.publish()
      }
    }
  }

  async capture() {
    const p = this.profile
    const signal = p.captureController.signal
    if (!p.token || !p.collecting || p.capturing || signal.aborted) return
    p.capturing = true
    let observed = false
    try {
      const due = p.screenshotsEnabled &&
        (Date.now() >= p.nextScreenshot || !!p.windowCandidate || !!p.history.windowSpan?.pendingObject)
      const { target, ...value } = due
        ? await this.sample(true)
        : await this.sample()
      if (signal.aborted) return
      const now = new Date()
      const previous = p.history.windowSpan
      const finished = recordWindow(p, value, now)
      observed = true
      if (finished) this.persist(p)
      else if (previous || p.history.windowSpan) save(p.file, p.history)
      if (due) await this.captureScreenshot(p, target, value, signal)
      if (p.sampleIssue) {
        p.sampleIssue = ''
        this.publish()
      }
    } catch (error) {
      if (!signal.aborted && p.sampleIssue !== error.message) {
        p.sampleIssue = error.message
        this.publish()
      }
    } finally {
      p.capturing = false
      // Keep the normal 15 s poll inexpensive. Recheck a newly observed window
      // at its dwell threshold instead of waiting for the next normal poll.
      clearTimeout(p.dwellTimer)
      const since = p.windowCandidate
        ? p.history.windowSpan?.awaySince ?? p.windowCandidate.start
        : p.history.windowSpan?.pendingObject?.occurred_at
      if (
        observed &&
        since &&
        !signal.aborted &&
        p === this.profile
      ) {
        const dueAt = Date.parse(since) + minDwellMs
        p.dwellTimer = setTimeout(
          () => this.capture(),
          Math.max(0, dueAt - Date.now()),
        )
      }
      if (
        signal.aborted &&
        p === this.profile &&
        p.collecting &&
        !p.controller.signal.aborted
      )
        void this.capture()
    }
  }

  close() {
    this.finishWindow()
    void this.profile.bridge.stop()
    clearInterval(this.pollTimer)
    clearInterval(this.captureTimer)
    clearInterval(this.notificationTimer)
    this.profile.controller.abort()
    this.profile.captureController.abort()
  }
}

module.exports = { DesktopAgent }
