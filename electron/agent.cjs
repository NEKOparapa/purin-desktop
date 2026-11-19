const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { randomUUID, createHash } = require('node:crypto')
const {
  submitMaterial,
  framePath,
  removeMaterialFiles,
  desktopWindowRoute,
} = require('./materials.cjs')
const { advanceWindowSpan } = require('./window-spans.cjs')
const { screenshotDwellMs, saveVisitScreenshot } = require('./visit-screenshot.cjs')
const { saveHistoryFile, readHistoryImage } = require('./history.cjs')
const { ChatHistory } = require('./chat-history.cjs')
const { availableTools, secureTransport, TerminalToolClient } = require('./terminal-tools.cjs')
const { detectObsidianVaults, inspectVault, runObsidianTool } = require('./obsidian-connector.cjs')
const { notificationPath, pageRoute, validatePage, deliverPending } = require('./notifications.cjs')
const memory = require('./memory.cjs')
const captureVersion = 6

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

function recordWindow(profile, sample, at, target) {
  const history = profile.history
  const previous = history.windowSpan
  const { active, finished } = advanceWindowSpan(previous, sample, at)
  if (finished) {
    const frames = previous.frames ?? []
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
  if (active) {
    if (profile.screenshotsEnabled && target && target.pid !== process.pid && !active.screenshotAttempted)
      active.screenshotDueAt ??= at.getTime() + screenshotDwellMs
    else delete active.screenshotDueAt
  }
  return finished
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
    for (const field of ['pending', 'lastObserved', 'lastSent', 'browserReceipts', 'processing']) {
      if (Object.hasOwn(history, field)) {
        delete history[field]
        changed = true
      }
    }
    if (history.lastMaterial && history.lastMaterial.label !== '前台停留') {
      delete history.lastMaterial
      changed = true
    }
    if (history.materials) {
      const retained = history.materials.filter(item =>
        item.source === 'window' && item.kind === 'perception' &&
        item.body?.state_key === 'desktop.window_span')
      if (retained.length !== history.materials.length) {
        history.materials = retained
        changed = true
      }
    }
    if (changed) save(file, history)
    const mediaDirectory = path.join(dir, 'media-' + path.parse(name.name).name.slice('terminal-'.length))
    // Old explicit-share attachments lived directly in this profile's media directory.
    // Current automatic frames live under periodic/.
    if (fs.existsSync(mediaDirectory)) {
      for (const entry of fs.readdirSync(mediaDirectory, { withFileTypes: true })) {
        if (entry.isFile() && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entry.name))
          fs.unlinkSync(path.join(mediaDirectory, entry.name))
      }
    }
  }
  delete settings.browserSecret
  delete settings.calendarFile
  delete settings.calendarSecret
  delete settings.windowTitles
  settings.captureVersion = captureVersion
  save(configFile, settings)
}

function connection(url, deviceId) {
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
    typeof deviceId !== 'string' ||
    !deviceId.trim() ||
    /[\r\n]/.test(deviceId)
  )
    throw new Error('设备 ID 无效')
  return { url: service.origin, deviceId: deviceId.trim() }
}

async function fetchResponse(profile, route, options) {
  const response = await fetch(profile.url + route, {
    ...options,
    redirect: 'error',
    headers: {
      Authorization: 'Bearer ' + profile.token,
      'X-Device-ID': profile.deviceId,
      ...(profile.installation && {
        'X-Device-Instance': profile.installation,
        'X-Device-Name': Buffer.from(profile.deviceName, 'utf8').toString('base64'),
      }),
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

async function request(profile, route, body, signal) {
  const ms = route.startsWith(desktopWindowRoute) ? 600000 : route === '/v1/messages/images' ? 60000 : 8000
  const timeout = AbortSignal.timeout(ms)
  const response = await fetchResponse(profile, route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
    const settings = read(this.configFile, { url: 'http://127.0.0.1:8080' })
    if (Object.hasOwn(settings, 'terminal')) {
      settings.deviceId ||= settings.terminal
      delete settings.terminal
      save(this.configFile, settings)
    }
    if (!settings.installation) {
      settings.installation = randomUUID()
      settings.deviceId ||= 'desktop-' + settings.installation
      settings.deviceName ||= os.hostname().slice(0, 80) || '桌面端'
      save(this.configFile, settings)
    }
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
    this.remoteTimer = setInterval(() => this.profile.remote?.poll(), 2000)
    this.pollTimer = setInterval(() => this.sync(), 2200)
    if (presentNotifications) this.notificationTimer = setInterval(() => this.pollNotifications(), 5000)
    this.captureTimer = setInterval(() => this.capture(), 1000)
    this.sync()
    this.capture()
  }

  open(settings, token) {
    this.finishWindow()
    this.profile?.remote?.close()
    this.profile?.controller.abort()
    this.profile?.captureController.abort()
    const key = createHash('sha256')
      .update(settings.url + '\n' + settings.deviceId)
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
      questions: [],
      questionsDigest: '[]',
    }
    const p = this.profile
    const obsidianInfo = inspectVault(p.obsidianVaultPath || '')
    p.obsidianVaultPath = obsidianInfo.valid ? obsidianInfo.path : (p.obsidianVaultPath || '')
    p.obsidianEnabled = !!(p.obsidianEnabled && obsidianInfo.valid)
    if (token && secureTransport(p.url)) {
      const scope = createHash('sha256').update(JSON.stringify([p.url, p.deviceId, token])).digest('hex')
      p.remote = new TerminalToolClient({
        file: path.join(this.dir, 'remote-tools-' + scope + '.json'),
        enabled: p.remoteCommandsEnabled === true,
        tools: availableTools(),
        extraTools: p.obsidianEnabled ? ['obsidian'] : [],
        handlers: p.obsidianEnabled
          ? { obsidian: (call) => runObsidianTool(p.obsidianVaultPath, call.arguments) }
          : {},
        post: (route, body) => request(p, route, body, p.controller.signal),
        read, save, onIssue: () => this.publish(),
      })
      void p.remote.poll()
      void this.syncObsidianConnector(p)
      void this.syncTerminalConnector(p)
    }
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
    p.screenshotEpoch = 0
    // An interrupted visit from the former title sampler may hold provisional frames.
    // Keep at most one eligible image; already queued requests retain their original payload.
    const recovered = p.history.windowSpan
    if (recovered?.titleRun || recovered?.frames?.some(frame => frame.segment)) {
      const due = Date.parse(recovered.start) + (recovered.awayMs || 0) + screenshotDwellMs
      const frame = [...(recovered.frames || []), ...(recovered.titleRun?.samples || [])]
        .find(item => Date.parse(item.occurred_at) >= due)
      recovered.frames = frame ? [frame] : []
      delete recovered.titleRun
      save(file, p.history)
    }
    if (!p.screenshotsEnabled && (p.history.windowSpan?.frames?.length ||
        p.history.materials.some(item => item.frames?.length))) {
      this.dropAutomatic(p, 'screenshot')
      save(p.file, p.history)
    }
    // A crash between saving the JPEG and committing its queue entry can leave an orphan.
    const directory = path.join(p.mediaDirectory, 'periodic')
    if (fs.existsSync(directory)) {
      const queued = new Set((p.history.windowSpan?.frames || []).map(frame => frame.id))
      for (const item of p.history.materials) {
        for (const frame of item.frames || []) queued.add(frame.id)
      }
      for (const id of fs.readdirSync(directory))
        if (/^[0-9a-f-]{36}$/.test(id) && !queued.has(id))
          fs.rmSync(path.join(directory, id), { force: true })
    }
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
  }

  state() {
    const p = this.profile
    return {
      url: p.url,
      deviceId: p.deviceId,
      deviceName: p.deviceName,
      connectionRevision: p.revision,
      appearance: this.appearance,
      configured: !!p.token,
      remoteCommandsEnabled: !!p.remote?.enabled,
      remoteTools: p.remote?.tools || [],
      remoteIssue: p.remote?.issue || '',
      obsidianEnabled: !!p.obsidianEnabled,
      obsidianVaultPath: p.obsidianVaultPath || '',
      collecting: !!p.collecting,
      screenshotsEnabled: !!p.screenshotsEnabled,
      screenshotIssue: p.screenshotIssue || '',
      pendingMaterials: p.history.materials.length,
      materialIssue: p.materialIssue || '',
      lastMaterial: p.history.lastMaterial || null,
      failedMaterial:
        p.history.materials.find((item) => item.error)?.id || null,
      issue: p.issue,
      sampleIssue: p.sampleIssue,
      lastSpan: p.history.lastSpan ?? null,
      messages: this.chatMessages(p),
      hasEarlier: p.chat.hasEarlier,
      questions: p.questions || [],
    }
  }

  chatMessages(p) {
    const pending = new Map(p.history.outbox.map(row => [row.id, row]))
    const byEvent = new Map(p.history.outbox.filter(m => m.eventId).map(m => [m.eventId, m]))
    const messages = p.chat.messages.map(row => {
      if (row.role !== 'user') return row
      const local = byEvent.get(row.id) || (row.deviceId === p.deviceId && pending.get(row.messageId))
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

  async configure({ url, deviceId, token, deviceName }) {
    const dest = connection(url, deviceId)
    const old = this.profile
    const name = (deviceName ?? old.deviceName).trim()
    if (!name || [...name].length > 80 || /\p{Cc}/u.test(name))
      throw new Error('请输入 1 至 80 个字符的设备名')
    const identity = { installation: old.installation, deviceName: name }
    const same = old.url === dest.url && old.deviceId === dest.deviceId
    const credential = token?.trim() || (same && old.token)
    if (!credential) throw new Error('请输入设备令牌')
    try {
      await request({ ...dest, ...identity, token: credential }, '/v1/devices/self', {})
    } catch (error) {
      if (error.code === 'device_id_in_use') throw new Error('此设备 ID 已绑定其他设备，请为本机登记独立的设备 ID')
      throw error
    }
    if (this.profile !== old) throw new Error('连接已更改，请重试')
    const secret = this.secure.encryptString(credential).toString('base64')
    const settings = {
      ...(same ? this.settings(old) : {}),
      ...dest,
      ...identity,
      captureVersion,
      secret,
      remoteCommandsEnabled: same && old.token === credential && !!old.remote?.enabled,
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

  async requestMemory(route, validate) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
    try {
      const doc = await request(p, route, undefined, p.controller.signal)
      if (p !== this.profile || p.controller.signal.aborted) throw new Error('连接已更改')
      return validate(doc)
    } catch (error) {
      if (p !== this.profile || p.controller.signal.aborted) throw new Error('连接已更改')
      if (error.code === 'memory_unconfigured') throw new Error('后端尚未配置当前用户的记忆目录。')
      if (error.code === 'memory_file_not_found') throw new Error('档案已不存在，请刷新目录。')
      if (error.code === 'record_storage_unavailable') throw new Error('暂时无法读取记录原文，请稍后重试。')
      if (error.status === 404) throw new Error('记录不存在或后端接口不可用，请刷新并确认后端已更新。')
      if (error instanceof SyntaxError) throw new Error('后端返回的记忆数据格式无效')
      throw error
    }
  }

  memoryTree() {
    return this.requestMemory('/v1/memory/tree', memory.validateTree)
  }

  memoryFile(path) {
    return this.requestMemory(memory.fileRoute(path), doc => memory.validateFile(doc, path))
  }

  recordItems(options) {
    return this.requestMemory(memory.recordsRoute(options), memory.validateRecords)
  }

  recordContent(options) {
    return this.requestMemory(memory.contentRoute(options), page => memory.validateContent(page, options))
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
    if (!p.token) throw new Error('请先连接设备')
    if (!secureTransport(p.url))
      throw new Error('管理接口密钥需要 HTTPS 或本机连接')

    let page
    try {
      page = await request(p, '/v1/settings/api-keys', body, p.controller.signal)
    } catch (error) {
      if (p !== this.profile || p.controller.signal.aborted)
        throw new Error('连接已更改，请重新打开接口密钥')
      if (error.code === 'secure_transport_required')
        throw new Error('管理接口密钥需要 HTTPS 或本机连接')
      if (error.status === 401) throw new Error('设备令牌无效，请重新连接')
      if (error.status === 403) throw new Error('此设备没有管理接口密钥的权限')
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
    if (!p.token) throw new Error('请先连接设备')
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
    if (!p.token) throw new Error('请先连接设备')
    return request(p, notificationPath(id) + '/read', {}, p.controller.signal)
  }

  downloadNotificationFile({notificationId, file}, choosePath) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
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
    if (!profile.token) throw new Error('请先连接设备')
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

  async terminalToolHistory(cursor) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
    const query = new URLSearchParams({ limit: '20' })
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || !cursor || cursor.length > 2048)
        throw new Error('无效的调用记录分页位置')
      query.set('cursor', cursor)
    }
    const page = await request(p, '/v1/terminal-tools/history?' + query, undefined, p.controller.signal)
    if (p !== this.profile) throw new Error('连接已更改')
    const invalid = '后端返回的设备调用记录格式有误'
    if (!Array.isArray(page?.items) ||
        !(page.next_cursor === null || (typeof page.next_cursor === 'string' && page.next_cursor)))
      throw new Error(invalid)
    const items = page.items.map(item => {
      if (!item || typeof item.id !== 'string' || typeof item.device_id !== 'string' ||
          typeof item.tool !== 'string' || !item.arguments || typeof item.arguments !== 'object' ||
          Array.isArray(item.arguments) ||
          !['queued', 'running', 'succeeded', 'failed', 'timed_out', 'expired'].includes(item.status) ||
          !Number.isInteger(item.timeout_seconds) || !Number.isFinite(Date.parse(item.created_at)) ||
          ![item.started_at, item.completed_at].every(at => at === null || Number.isFinite(Date.parse(at))) ||
          typeof item.stdout !== 'string' || typeof item.stderr !== 'string' ||
          (item.exit_code !== null && !Number.isInteger(item.exit_code)) || typeof item.truncated !== 'boolean')
        throw new Error(invalid)
      const { id, device_id, tool, timeout_seconds, status, created_at, started_at,
        completed_at, stdout, stderr, exit_code, truncated } = item
      return { id, device_id, tool, arguments: item.arguments, timeout_seconds,
        status, created_at, started_at, completed_at, stdout, stderr, exit_code, truncated }
    })
    return { items, next_cursor: page.next_cursor }
  }

  async history({ view, cursor, groupId }) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
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
    const projection = { slice: 'slicetimeline', timeline: 'merged' }[view]
    if (projection && (!cursor || cursor.startsWith(projection + ':'))) {
      query.set('view', projection)
      try {
        return await get('/v1/history?' + query)
      } catch (error) {
        if (cursor || error.status !== 400 || error.code !== 'invalid_query') throw error
        query.set('view', view)
      }
    }
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

  async compression({ kind, layer, id, activity, cursor, record }) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
    const query = new URLSearchParams({ limit: '40' })
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || !cursor || cursor.length > 2048)
        throw new Error('无效的分页位置')
      query.set('cursor', cursor)
    }
    let path = '/v1/history/compression'
    if (kind === 'list' && ['perception', 'slice'].includes(layer)) {
      query.set('layer', layer)
    } else if (kind === 'trace') {
      if (typeof id !== 'string' || !/^(?:round-\d{1,19}|history-\d{1,19}-\d{1,10})$/.test(id))
        throw new Error('无效的时间轴记录')
      path = '/v1/history/traces/' + id
    } else if (kind === 'source' || kind === 'batch' || kind === 'stages') {
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
      if (kind === 'stages') {
        path = '/v1/history/perceptions/' + encodeURIComponent(id) + '/stages'
        if (record === true) path += '?record=1'
      } else if (kind === 'source') {
        path += '/sources'
        if (activity === true) query.set('activity', '1')
      }
      if (kind !== 'stages') path += '/' + encodeURIComponent(id)
    } else {
      throw new Error('未知的压缩记录类型')
    }
    try {
      return await request(
        p,
        kind === 'stages' ? path : path + '?' + query,
        undefined,
        p.controller.signal,
      )
    } catch (error) {
      if (error.status === 404)
        throw new Error(
          kind === 'stages' ? '后端未提供这条记录的压缩过程。请确认后端已更新，再刷新记录。' : kind === 'list'
            ? '当前后端未提供压缩对照，请升级后端后刷新。'
            : '找不到这条记录。如使用旧后端，请升级后再查看详情。',
        )
      throw error
    }
  }

  downloadHistoryFile(file, choosePath) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
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

  async previewHistoryImage({ id, connectionRevision }) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
    if (connectionRevision !== p.revision) throw new Error('连接已更改，请重新打开记忆')
    if (typeof id !== 'string' || !/^[\w:-]{1,256}$/.test(id))
      throw new Error('无效的截图编号')
    try {
      const response = await fetchResponse(p, '/v1/history/files/' + encodeURIComponent(id), {
        signal: AbortSignal.any([p.controller.signal, AbortSignal.timeout(30000)]),
      })
      const bytes = await readHistoryImage(response)
      if (p !== this.profile) throw new Error('连接已更改，请重新打开记忆')
      return bytes
    } catch (error) {
      if (p !== this.profile || p.controller.signal.aborted)
        throw new Error('连接已更改，请重新打开记忆')
      if (error.status === 404) throw new Error('后端找不到这张截图')
      throw error
    }
  }

  settings(p = this.profile) {
    return {
      remoteCommandsEnabled: !!p.remote?.enabled,
      obsidianEnabled: !!p.obsidianEnabled,
      obsidianVaultPath: p.obsidianVaultPath || '',
      url: p.url,
      deviceId: p.deviceId,
      deviceName: p.deviceName,
      installation: p.installation,
      secret: p.secret,
      collecting: !!p.collecting,
      screenshotsEnabled: !!p.screenshotsEnabled,
      appearance: this.appearance,
      captureVersion,
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

  setRemoteCommands({ enabled, connectionRevision }) {
    const p = this.profile
    if (!p.token || p.revision !== connectionRevision || typeof enabled !== 'boolean')
      throw new Error('连接已更改，请重新打开设备设置')
    if (!p.remote) throw new Error('远程命令需要 HTTPS 或本机连接')
    if (enabled && !p.remote.tools.length) throw new Error('本机没有可用的命令行工具')
    this.savePreferences({ remoteCommandsEnabled: enabled })
    p.remote.setEnabled(enabled)
    void this.syncTerminalConnector(p)
    this.publish()
  }

  async syncTerminalConnector(p = this.profile) {
    if (!p.token || !secureTransport(p.url) || p.controller.signal.aborted) return
    const enabled = !!p.remote?.enabled
    try {
      await request(
        p,
        '/v1/connectors/device-sync',
        {
          id: 'terminal',
          name: '本机命令行',
          enabled,
          config: enabled ? { tools: p.remote?.tools || [] } : {},
        },
        p.controller.signal,
      )
    } catch {
      /* Backend may be offline or not upgraded yet. */
    }
  }

  async connectorHistory(cursor) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
    const query = cursor ? '?cursor=' + encodeURIComponent(cursor) : ''
    const data = await request(p, '/v1/connectors/history' + query, undefined, p.controller.signal)
    if (p !== this.profile || p.controller.signal.aborted) throw new Error('连接已更改')
    return {
      items: Array.isArray(data.items) ? data.items : [],
      next_cursor: typeof data.next_cursor === 'string' ? data.next_cursor : null,
    }
  }

  obsidianState(p = this.profile) {
    const info = inspectVault(p.obsidianVaultPath || '')
    return {
      enabled: !!(p.obsidianEnabled && info.valid),
      vaultPath: p.obsidianVaultPath || '',
      vaultName: info.name || '',
      noteCount: info.noteCount || 0,
      hasObsidianDir: info.hasObsidianDir || false,
      valid: info.valid,
      detectedVaults: detectObsidianVaults(),
    }
  }

  async syncObsidianConnector(p = this.profile) {
    if (!p.token || !secureTransport(p.url) || p.controller.signal.aborted) return
    const info = inspectVault(p.obsidianVaultPath || '')
    const enabled = !!(p.obsidianEnabled && info.valid)
    try {
      await request(
        p,
        '/v1/connectors/device-sync',
        {
          id: 'obsidian',
          name: 'Obsidian',
          enabled,
          config: enabled
            ? { vaultName: info.name, noteCount: info.noteCount }
            : {},
        },
        p.controller.signal,
      )
    } catch {
      /* Backend may be offline or not upgraded yet; will sync on next open or toggle. */
    }
  }

  async connectors() {
    const p = this.profile
    const obsidian = this.obsidianState(p)
    if (!p.token) return { items: [], obsidian }
    const data = await request(p, '/v1/connectors', undefined, p.controller.signal)
    if (p !== this.profile || p.controller.signal.aborted) throw new Error('连接已更改')
    return { items: Array.isArray(data.items) ? data.items : [], obsidian }
  }

  async setObsidianConnector({ enabled, vaultPath, connectionRevision }) {
    const p = this.profile
    if (typeof enabled !== 'boolean') throw new Error('Obsidian 连接设置无效')
    if (connectionRevision !== undefined && p.revision !== connectionRevision)
      throw new Error('连接已更改，请重新打开连接器设置')
    const targetPath = typeof vaultPath === 'string' ? vaultPath.trim() : (p.obsidianVaultPath || '')
    if (enabled) {
      const info = inspectVault(targetPath)
      if (!info.valid) throw new Error('请选择有效的 Obsidian Vault 目录')
      p.obsidianVaultPath = info.path
      p.obsidianEnabled = true
    } else {
      if (typeof vaultPath === 'string') p.obsidianVaultPath = targetPath
      p.obsidianEnabled = false
    }
    this.savePreferences({
      obsidianEnabled: p.obsidianEnabled,
      obsidianVaultPath: p.obsidianVaultPath,
    })
    if (p.remote) {
      p.remote.setExtraTools(
        p.obsidianEnabled ? ['obsidian'] : [],
        p.obsidianEnabled
          ? { obsidian: (call) => runObsidianTool(p.obsidianVaultPath, call.arguments) }
          : {},
      )
    }
    await this.syncObsidianConnector(p)
    this.publish()
    return this.obsidianState(p)
  }

  async addMcpConnector(payload) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
    if (payload?.credentials && !secureTransport(p.url))
      throw new Error('保存连接器凭据需要 HTTPS 或本机连接')
    const data = await request(p, '/v1/connectors/mcp', payload, p.controller.signal)
    if (p !== this.profile || p.controller.signal.aborted) throw new Error('连接已更改')
    return data
  }

  async saveConnectorCredentials({ id, values, connectionId, connectionLabel }) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
    if (!secureTransport(p.url)) throw new Error('保存连接器凭据需要 HTTPS 或本机连接')
    const body = {
      values,
      ...(connectionId ? { connection_id: connectionId } : {}),
      ...(connectionLabel ? { connection_label: connectionLabel } : {}),
    }
    const data = await request(
      p,
      '/v1/connectors/' + encodeURIComponent(id) + '/credentials',
      body,
      p.controller.signal,
    )
    if (p !== this.profile || p.controller.signal.aborted) throw new Error('连接已更改')
    return data
  }

  async testConnector(id) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
    const data = await request(
      p,
      '/v1/connectors/' + encodeURIComponent(id) + '/test',
      {},
      p.controller.signal,
    )
    if (p !== this.profile || p.controller.signal.aborted) throw new Error('连接已更改')
    return data
  }

  async deleteConnector(id) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
    const timeout = AbortSignal.timeout(8000)
    const response = await fetchResponse(
      p,
      '/v1/connectors/' + encodeURIComponent(id),
      {
        method: 'DELETE',
        headers: {},
        signal: AbortSignal.any([timeout, p.controller.signal]),
      },
    )
    if (p !== this.profile || p.controller.signal.aborted) throw new Error('连接已更改')
    return response.json()
  }

  setCollection(enabled) {
    const p = this.profile
    if (!p.token || typeof enabled !== 'boolean')
      throw new Error('请先连接设备')
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

  setScreenshots({ enabled }) {
    const p = this.profile
    if (
      !p.token ||
      typeof enabled !== 'boolean'
    )
      throw new Error('截图设置无效')
    if (enabled && (!p.collecting || !this.screenshot))
      throw new Error('请先开启桌面活动采集')
    this.savePreferences({
      screenshotsEnabled: enabled,
    })
    p.screenshotsEnabled = enabled
    p.screenshotEpoch++
    p.screenshotIssue = ''
    if (!enabled) this.dropAutomatic(p, 'screenshot')
    this.persist(p)
  }

  finishWindow() {
    const p = this.profile
    if (!p?.history.windowSpan || p.controller.signal.aborted) return
    recordWindow(p, null, new Date())
    this.persist(p)
  }

  clearActivity(p) {
    this.dropAutomatic(p, 'window')
    p.history.windowSpan = null
  }

  // Remove queued observations when their source is disconnected.
  dropAutomatic(p, source) {
    if (p.uploading?.source === source) p.uploadController?.abort()
    const removed = []
    if (source === 'screenshot') {
      if (p.history.windowSpan) delete p.history.windowSpan.screenshotDueAt
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

  async flushMaterials(p = this.profile) {
    if (p.flushing || !p.token || p.controller.signal.aborted) return
    p.flushing = true
    try {
      // Deliver completed visits in capture order.
      for (const item of [...p.history.materials]) {
        if (p.controller.signal.aborted) return
        if (!p.history.materials.includes(item)) continue
        if (item.retryAt > Date.now() || item.rejected) break
        p.uploading = item
        p.uploadController = new AbortController()
        try {
          await submitMaterial(
            p,
            item,
            request,
            p.uploadController.signal,
          )
          if (!p.history.materials.includes(item)) continue
        } catch (error) {
          if (p.controller.signal.aborted) return
          if (p.uploadController.signal.aborted || !p.history.materials.includes(item)) continue
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
          break
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

  async transcribe({ audio, connectionRevision }) {
    const p = this.profile
    if (!p.token || p.revision !== connectionRevision) throw new Error('设备连接已更改')
    if (!(audio instanceof ArrayBuffer) || !audio.byteLength || audio.byteLength > 3840044)
      throw new Error('录音无效或超过两分钟')
    const response = await fetchResponse(p, '/v1/transcriptions', {
      method: 'POST', body: Buffer.from(audio), headers: { 'Content-Type': 'audio/wav' },
      signal: AbortSignal.any([p.controller.signal, AbortSignal.timeout(200000)]),
    }).catch(error => {
      if (error.code === 'asr_key_missing') throw new Error('请先在后端配置语音转录密钥')
      throw error
    })
    const { text } = await response.json()
    if (this.profile !== p || typeof text !== 'string') throw new Error('转写结果无效')
    return text
  }

  async uploadChatFile({ name, data, revision }) {
    const p = this.profile
    if (!p.token || p.revision !== revision) throw new Error('设备连接已更改')
    if (typeof name !== 'string' || !name.trim() || !(data instanceof ArrayBuffer) || data.byteLength > 32 * 1024 * 1024)
      throw new Error('文件无效或超过 32 MiB')
    try {
      const response = await fetchResponse(p, '/v1/chat/files?' + new URLSearchParams({ name }), {
        method: 'POST', body: Buffer.from(data), headers: { 'Content-Type': 'application/octet-stream' },
        signal: AbortSignal.any([p.controller.signal, AbortSignal.timeout(330000)]),
      })
      const file = await response.json()
      if (p !== this.profile || !/^doc_[a-f0-9]{64}$/.test(file.id) || file.name !== name)
        throw new Error('文件回执无效')
      return { id: file.id, name }
    } catch (error) {
      const reasons = { unsupported_file: 'MarkItDown 无法识别此格式', file_conversion_failed: '文件无法解析，请检查文件是否损坏或加密',
        asr_key_missing: '后端缺少音频转写密钥',
        audio_conversion_failed: '音频转写失败', file_conversion_timeout: '解析超时', chat_media_busy: '后端正忙，请重试' }
      throw new Error(name + '：' + (reasons[error.code] || error.message))
    }
  }

  send(message) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
    const { text, images = [], documents = [], imageNames = [], revision } = typeof message === 'string' ? { text: message } : message
    if (revision !== undefined && revision !== p.revision) throw new Error('设备连接已更改')
    if (!Array.isArray(images) || images.length > 4 || images.some(image =>
      typeof image !== 'string' || !image.startsWith('data:image/jpeg;base64,') || image.length > 699075))
      throw new Error('聊天图片无效')
    if (!Array.isArray(documents) || documents.length + images.length > 4 ||
      documents.some(doc => !/^doc_[a-f0-9]{64}$/.test(doc?.id) || typeof doc.name !== 'string') ||
      !Array.isArray(imageNames) || (imageNames.length && imageNames.length !== images.length))
      throw new Error('聊天附件无效')
    if (typeof text !== 'string' || (!text.trim() && !images.length && !documents.length))
      throw new Error('消息不能为空')
    const entry = {
      id: randomUUID(),
      role: 'user',
      text: text.trim() || (documents.length ? '请阅读附件。' : '请描述图片内容。'),
      ...(images.length && { images }),
      ...(imageNames.length && { imageNames }),
      ...(documents.length && { documents }),
      at: new Date().toISOString(),
      status: 'queued',
    }
    p.history.outbox.push(entry)
    try {
      save(p.file, p.history)
    } catch (error) {
      p.history.outbox.pop()
      throw error
    }
    this.publish()
    this.sync()
  }

  retry(id) {
    const p = this.profile
    const m = p.history.outbox.find(
      (row) => row.id === id && row.role === 'user',
    )
    if (!m || !p.token) return
    if (['failed', 'interrupted', 'missing'].includes(m.status))
      return this.send({ text: m.text, images: m.images, documents: m.documents, imageNames: m.imageNames })
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
          const receipt = await api(m.images?.length ? '/v1/messages/images' : '/v1/messages', {
            message_id: m.id,
            text: m.text,
            ...(m.images?.length && { images: m.images }),
            ...(m.imageNames?.length && { image_names: m.imageNames }),
            ...(m.documents?.length && { documents: m.documents }),
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
        this.syncQuestions(p, api),
        p.chat.read(api).then(changed => {
          if (p.controller.signal.aborted) return
          // The POST may have reached the server even if its receipt was lost.
          const accepted = new Set(p.chat.messages.filter(row => row.deviceId === p.deviceId && row.messageId).map(row => row.messageId))
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

  async syncQuestions(p, api) {
    try {
      const page = await api('/v1/questions?status=pending&limit=20')
      if (p !== this.profile || p.controller.signal.aborted) return
      const items = Array.isArray(page?.items) ? page.items : []
      const digest = JSON.stringify(items)
      if (digest !== p.questionsDigest) {
        p.questions = items
        p.questionsDigest = digest
        this.publish()
      }
    } catch (error) {
      // Older backends may not expose /v1/questions yet.
      if (error.status === 404) return
      throw error
    }
  }

  async answerQuestion({ id, selectedOptions, answerText } = {}) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
    if (typeof id !== 'string' || !id) throw new Error('无效的提问编号')
    try {
      const item = await request(
        p,
        '/v1/questions/' + encodeURIComponent(id) + '/answer',
        {
          selected_options: Array.isArray(selectedOptions) ? selectedOptions : [],
          answer_text: typeof answerText === 'string' ? answerText : '',
        },
        p.controller.signal,
      )
      if (p === this.profile && !p.controller.signal.aborted) {
        p.questions = (p.questions || []).filter(q => q.id !== id)
        p.questionsDigest = JSON.stringify(p.questions)
        this.publish()
        void this.sync()
      }
      return item
    } catch (error) {
      if (error.status === 409 && p === this.profile && !p.controller.signal.aborted) {
        p.questions = (p.questions || []).filter(q => q.id !== id)
        p.questionsDigest = JSON.stringify(p.questions)
        this.publish()
        throw new Error('该提问已在其他设备处理')
      }
      if (error.status === 400) throw new Error('请至少选择一个选项或填写回答内容')
      throw error
    }
  }

  async dismissQuestion(id) {
    const p = this.profile
    if (!p.token) throw new Error('请先连接设备')
    if (typeof id !== 'string' || !id) throw new Error('无效的提问编号')
    try {
      const item = await request(
        p,
        '/v1/questions/' + encodeURIComponent(id) + '/dismiss',
        {},
        p.controller.signal,
      )
      if (p === this.profile && !p.controller.signal.aborted) {
        p.questions = (p.questions || []).filter(q => q.id !== id)
        p.questionsDigest = JSON.stringify(p.questions)
        this.publish()
        void this.sync()
      }
      return item
    } catch (error) {
      if (error.status === 409 && p === this.profile && !p.controller.signal.aborted) {
        p.questions = (p.questions || []).filter(q => q.id !== id)
        p.questionsDigest = JSON.stringify(p.questions)
        this.publish()
        throw new Error('该提问已在其他设备处理')
      }
      throw error
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
      value.activity !== 'active' ||
      span.screenshotAttempted ||
      span.screenshotDueAt == null ||
      Date.parse(span.lastSeen) < span.screenshotDueAt
    )
      return
    span.screenshotAttempted = true
    delete span.screenshotDueAt
    const epoch = p.screenshotEpoch
    const valid = () =>
      !signal.aborted && p === this.profile && epoch === p.screenshotEpoch &&
      p.history.windowSpan?.id === span.id
    try {
      const occurredAt = span.lastSeen
      const { jpegBase64 } = await this.screenshot(target)
      if (!valid()) return
      const after = await this.sample(true)
      if (!valid()) return
      if (
        after.activity !== 'active' ||
        after.target?.id !== target.id ||
        after.target?.pid !== target.pid ||
        after.foreground_app !== value.foreground_app
      ) {
        const { target: nextTarget, ...nextValue } = after
        const finished = recordWindow(p, nextValue, new Date(), nextTarget)
        if (finished) this.persist(p)
        else save(p.file, p.history)
        return
      }
      const title = after.window_title === value.window_title ? value.window_title : undefined
      if (after.window_title !== value.window_title) recordWindow(p, after, new Date(), after.target)
      span.frames = [saveVisitScreenshot(p, jpegBase64, occurredAt, title)]
      save(p.file, p.history)
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
    try {
      const { target, ...value } = p.screenshotsEnabled
        ? await this.sample(true)
        : await this.sample()
      if (signal.aborted) return
      const now = new Date()
      const previous = p.history.windowSpan
      const finished = recordWindow(p, value, now, target)
      if (finished) this.persist(p)
      else if ((previous || p.history.windowSpan) &&
        (previous?.id !== p.history.windowSpan?.id || now >= (p.nextCheckpoint || 0))) {
        save(p.file, p.history)
        p.nextCheckpoint = now.getTime() + 15_000
      }
      if (p.screenshotsEnabled) await this.captureScreenshot(p, target, value, signal)
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
    clearInterval(this.remoteTimer)
    this.profile.remote?.close()
    clearInterval(this.pollTimer)
    clearInterval(this.captureTimer)
    clearInterval(this.notificationTimer)
    this.profile.controller.abort()
    this.profile.captureController.abort()
  }
}

module.exports = { DesktopAgent }
