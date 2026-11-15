const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')
const { DesktopAgent } = require('../electron/agent.cjs')

async function until(check, timeout = 12000) {
  const end = performance.now() + timeout
  while (!check()) {
    if (performance.now() > end)
      assert.fail('timed out waiting for material delivery')
    await delay(20)
  }
}

async function setup(t, handle) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-material-tests-'))
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    res.setHeader('Content-Type', 'application/json')
    if (req.url.startsWith('/v1/outputs?')) {
      res.end(JSON.stringify({ outputs: [] }))
      return
    }
    if (req.url.startsWith('/v1/history?')) return res.end(JSON.stringify({ items: [], next_cursor: null }))
    const bytes = Buffer.concat(chunks)
    const item = {
      route: req.url,
      headers: req.headers,
      bytes,
      terminal: req.headers['x-terminal-id'],
      body:
        req.headers['content-type'] === 'application/json'
          ? JSON.parse(bytes.toString())
          : undefined,
    }
    const response = handle(item)
    const status = response?.status ?? response
    if (status === 'disconnect') return req.socket.destroy()
    res.writeHead(status)
    res.end(
      JSON.stringify(
        response?.json ??
          (status === 202
            ? { event_id: 'fixture-ack' }
            : {
                error:
                  status === 409
                    ? 'event_id_conflict'
                    : 'temporarily_unavailable',
              }),
      ),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = 'http://127.0.0.1:' + server.address().port
  const clients = []
  function launch(sample = () => ({ activity: 'idle' }), screenshot) {
    const client = new DesktopAgent(
      dir,
      {
        encryptString: (text) => Buffer.from(text),
        decryptString: (bytes) => bytes.toString(),
      },
      sample,
      () => {},
      screenshot,
    )
    clients.push(client)
    return client
  }
  t.after(async () => {
    for (const client of clients) client.close()
    await new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    })
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { launch, dir, url }
}

test('timed screenshots follow the active window span, survive retries and stop independently', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 14, 1) })
  const requests = []
  let online = false
  const { launch, url } = await setup(t, (item) => {
    requests.push(item)
    return !online && item.route === '/v1/image/slices' ? 503 : 202
  })
  const active = {
    activity: 'active',
    foreground_app: '会议应用',
    window_title: '项目周会',
    target: { platform: 'windows', id: '251', pid: 123456 },
  }
  let sample = active
  let changed = false,
    calls = 0
  const jpeg = Buffer.from([255, 216, 255, 217]).toString('base64')
  const read = () => sample
  const take = () => {
    calls++
    if (changed) sample = { ...active, target: { ...active.target, id: '252' } }
    return jpeg
  }
  let client = launch(read, take)
  await client.configure({ url, terminal: 'screenshot-test', token: 'fixture' })
  client.setCollection(true)
  await until(() => !client.profile.capturing)
  client.setScreenshots({ enabled: true, minutes: 1 })
  await client.capture()
  assert.equal(calls, 0)
  async function due(observation) {
    sample = observation
    client.profile.nextScreenshot = Date.now() - 1
    await client.capture()
  }
  await due({ activity: 'locked' })
  await due({ activity: 'idle' })
  const own = {
    ...active,
    foreground_app: 'Wintermute',
    window_title: '桌面设置',
    target: { ...active.target, pid: process.pid },
  }
  await due(own)
  t.mock.timers.tick(5000)
  await due(own)
  const start = new Date().toISOString()
  await due(active)
  assert.equal(calls, 0)
  t.mock.timers.tick(5000)
  changed = true
  await due(active)
  assert.equal(calls, 1)
  assert.ok(
    !client.profile.history.materials.some((item) => item.kind === 'image'),
  )
  changed = false
  await due(active)
  await until(() => !client.profile.flushing && !!client.state().failedMaterial)
  const image = client.profile.history.materials.find(
    (item) => item.kind === 'image',
  )
  const file = path.join(client.profile.mediaDirectory, 'periodic', image.id)
  assert.ok(fs.existsSync(file))
  assert.equal(image.context.app, '会议应用')
  assert.equal(image.context.title, '项目周会')
  // A screenshot falling due while another window flashes must not capture it.
  const callsBeforeSwitch = calls
  const wrong = {
    ...active,
    foreground_app: '邮件',
    window_title: '误切窗口',
    target: { ...active.target, id: '253' },
  }
  t.mock.timers.tick(1000)
  await due(wrong)
  t.mock.timers.tick(2999)
  await due(wrong)
  assert.equal(calls, callsBeforeSwitch)
  t.mock.timers.tick(1)
  sample = active
  client.profile.nextScreenshot = Date.now() + 60000
  await client.capture()
  t.mock.timers.tick(6000)
  await due({ activity: 'idle' })
  await client.flushMaterials()
  const delivered = requests.find(
    (item) => item.body?.event_id === image.context.activity_id,
  )
  assert.equal(delivered.route, '/v1/perceptions')
  assert.equal(delivered.body.state_key, 'desktop.window_span')
  assert.equal(delivered.body.occurred_at, delivered.body.value.ended_at)
  assert.deepEqual(delivered.body.value, {
    foreground_app: '会议应用',
    window_title: '项目周会',
    started_at: start,
    ended_at: new Date(Date.parse(start) + 15000).toISOString(),
    duration_seconds: 12,
  })
  const foreground = requests.filter(
    (item) => item.body?.state_key === 'desktop.activity',
  )
  assert.equal(foreground.length, 0)
  assert.ok(
    !requests.some((item) => item.body?.value?.window_title === '误切窗口'),
  )
  assert.ok(!requests.some((item) => item.route === '/v1/slices'))
  const uploaded = () =>
    requests.filter((item) => item.route === '/v1/image/slices')
  const headers = uploaded()[0].headers
  assert.deepEqual(
    JSON.parse(Buffer.from(headers['x-capture-context'], 'base64url')),
    image.context,
  )
  assert.equal(headers['x-event-id'], image.id)
  assert.equal(headers['x-occurred-at'], image.at)
  assert.ok(
    requests
      .filter((item) => item.route === '/v1/perceptions')
      .every((item) => !('target' in item.body.value)),
  )
  client.close()
  client = launch(read, take)
  await until(() => !client.profile.capturing && !client.profile.flushing)
  assert.equal(client.state().screenshotMinutes, 1)
  online = true
  client.manageFailed({ id: image.id, retry: true })
  await until(() => !fs.existsSync(file))
  assert.equal(
    uploaded().at(-1).headers['x-capture-context'],
    headers['x-capture-context'],
  )
  online = false
  await due(active)
  t.mock.timers.tick(5000)
  await due(active)
  await until(() => !client.profile.flushing && !!client.state().failedMaterial)
  client.shareMaterial({
    kind: 'image',
    jpegBase64: jpeg,
    occurredAt: new Date().toISOString(),
  })
  await until(() => !client.profile.flushing)
  client.setCollection(false)
  assert.equal(client.state().screenshotsEnabled, false)
  assert.equal(fs.readdirSync(path.dirname(file)).length, 0)
  assert.equal(
    client.profile.history.materials.filter((item) => item.kind === 'image')
      .length,
    1,
  )
  assert.equal(client.profile.history.materials[0].label, '主动分享的截图')
})

test('upgrade reroutes queued dwell to perceptions and resumes after a lost old slice receipt', async (t) => {
  const requests = []
  const ids = [randomUUID(), randomUUID()]
  const { launch, dir, url } = await setup(t, (item) => {
    requests.push(item)
    if (item.body?.event_id !== ids[0]) return 202
    return item.route === '/v1/slices'
      ? { status: 202, json: { duplicate: true, event_id: 'old-receipt' } }
      : 409
  })
  const terminal = 'offline-desktop'
  const key = createHash('sha256')
    .update(url + '\n' + terminal)
    .digest('hex')
  const at = '2026-11-13T02:00:00.000Z'
  const end = '2026-11-13T02:00:15.000Z'
  fs.writeFileSync(
    path.join(dir, 'agent-settings.json'),
    JSON.stringify({
      url,
      terminal,
      collecting: true,
      captureVersion: 2,
      secret: Buffer.from('offline-fixture').toString('base64'),
    }),
  )
  fs.writeFileSync(
    path.join(dir, 'terminal-' + key + '.json'),
    JSON.stringify({
      messages: [],
      pending: [],
      materials: ids.map((id) => ({
        id,
        kind: 'slice',
        source: 'window',
        label: '前台停留',
        rejected: true,
        body: {
          event_id: id,
          occurred_at: end,
          text: `桌面前台停留（采样估算）：${at} 至 ${end}，约 15 秒。应用「会议应用」，窗口标题「项目周会」。`,
        },
      })),
    }),
  )
  const client = launch()
  await until(() => !client.profile.history.materials.length)
  const legacy = requests.filter((item) => item.route === '/v1/slices')
  assert.deepEqual(
    legacy.map((item) => item.body.event_id),
    [ids[0]],
  )
  assert.match(
    legacy[0].body.text,
    /约 15 秒。应用「会议应用」，窗口标题「项目周会」。$/u,
  )
  const sent = requests.filter(
    (item) =>
      item.route === '/v1/perceptions' && ids.includes(item.body?.event_id),
  )
  assert.deepEqual(
    sent.map((item) => item.body.event_id),
    ids,
  )
  for (const item of sent) {
    assert.equal(item.route, '/v1/perceptions')
    assert.equal(item.body.state_key, 'desktop.window_span')
    assert.deepEqual(item.body.value, {
      foreground_app: '会议应用',
      window_title: '项目周会',
      started_at: at,
      ended_at: end,
      duration_seconds: 15,
    })
  }
})

test('shares survive a lost receipt and restart; failed audio leaves other formats deliverable', async (t) => {
  const sent = []
  let online = false
  const { launch, url } = await setup(t, (item) => {
    sent.push(item)
    if (item.route.endsWith('/audio/slices') && !online) return 503
    if (item.route.endsWith('/image/slices') && !online) return 'disconnect'
    return 202
  })
  const client = launch()
  await client.configure({ url, terminal: 'desktop-A', token: 'A-only' })
  const at = new Date().toISOString()
  // Synthetic opaque bytes: this transport test exercises the headers, queue and spool.
  const audio = Buffer.from('OggS transport fixture')
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  client.shareMaterial({
    kind: 'audio',
    occurredAt: at,
    samples: 16000,
    oggBase64: audio.toString('base64'),
  })
  client.shareMaterial({
    kind: 'image',
    occurredAt: at,
    jpegBase64: image.toString('base64'),
  })
  client.shareMaterial({ kind: 'text', occurredAt: at, text: '演示改到周五' })
  await until(
    () =>
      sent.some((item) => item.route === '/v1/slices') &&
      client.state().pendingMaterials === 2,
  )
  const spooled = client.profile.mediaDirectory
  assert.equal(fs.readdirSync(spooled).length, 2)
  client.close()
  online = true
  const restarted = launch()
  await until(
    () =>
      restarted.state().pendingMaterials === 0 &&
      fs.readdirSync(spooled).length === 0,
  )
  const audioAttempts = sent.filter((item) => item.route === '/v1/audio/slices')
  const images = sent.filter((item) => item.route === '/v1/image/slices')
  const notes = sent.filter((item) => item.route === '/v1/slices')
  assert.equal(notes.length, 1)
  assert.match(notes[0].body.text, /演示改到周五/)
  assert.equal(notes[0].body.occurred_at, at)
  assert.ok(audioAttempts.length >= 2 && images.length >= 2)
  for (const upload of audioAttempts) {
    const h = upload.headers
    assert.deepEqual(upload.bytes, audio)
    assert.equal(h['content-type'], 'audio/ogg')
    assert.equal(
      h['x-recording-id'],
      audioAttempts[0].headers['x-recording-id'],
    )
    assert.ok(h['x-recording-id'])
    assert.equal(h['x-sample-rate'], '16000')
    assert.equal(h['x-sample-count'], '16000')
    assert.equal(h['x-start-sample'], '0')
    assert.equal(h['x-segment-sequence'], '1')
    assert.ok(Number(h['x-recording-elapsed-samples']) >= 16000)
  }
  for (const upload of images) {
    assert.deepEqual(upload.bytes, image)
    assert.equal(upload.headers['content-type'], 'image/jpeg')
    assert.equal(upload.headers['x-event-id'], images[0].headers['x-event-id'])
    assert.ok(upload.headers['x-event-id'])
    assert.equal(upload.headers['x-occurred-at'], at)
  }
  for (const item of sent) {
    assert.equal(item.terminal, 'desktop-A')
    assert.equal(item.headers.authorization, 'Bearer A-only')
  }
})

test('browser observations retain source order across retries and terminal switches', async (t) => {
  let online = false
  const attempts = []
  const delivered = []
  const { launch, url } = await setup(t, (item) => {
    attempts.push(item)
    if (!online && item.route === '/v1/perceptions') return 503
    delivered.push(item)
    return 202
  })
  const client = launch()
  const a = { url, terminal: 'A', token: 'key-A' }
  const b = { url, terminal: 'B', token: 'key-B' }
  await client.configure(a)
  await client.setBrowser(true)
  const [, port, token] = client.pairingCode().split('.')
  async function observe(title) {
    const response = await fetch('http://127.0.0.1:' + port + '/capture', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'chrome-extension://eglbccbkkdgfkokcificnicgigmehpbb',
        authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({
        kind: 'page',
        occurred_at: new Date().toISOString(),
        event_id: randomUUID(),
        title,
        domain: 'docs.example',
      }),
    })
    assert.equal(response.status, 202)
  }
  await observe('开会')
  await until(() =>
    attempts.some((row) => row.body?.state_key === 'browser.page'),
  )
  await observe('会后记录')
  assert.equal(client.state().pendingMaterials, 2)
  await client.configure(b)
  assert.equal(client.state().pendingMaterials, 0)
  assert.equal(client.state().browserEnabled, false)
  online = true
  client.shareMaterial({
    kind: 'text',
    text: 'B 自己的笔记',
    occurredAt: new Date().toISOString(),
  })
  await until(() => client.state().pendingMaterials === 0)
  assert.deepEqual(
    delivered.map((row) => row.terminal),
    ['B'],
  )
  await client.configure(a)
  await until(() => client.state().pendingMaterials === 0)
  const received = delivered.filter((row) => row.terminal === 'A')
  assert.deepEqual(
    received
      .filter((row) => row.body.state_key === 'browser.page')
      .map((row) => row.body.value.title),
    ['开会', '会后记录'],
  )
  for (const row of attempts)
    assert.equal(row.headers.authorization, 'Bearer key-' + row.terminal)
})

test('upgrade removes old calendar preferences and queued observations while preserving explicit shares', async (t) => {
  const sent = []
  const { launch, url, dir } = await setup(t, (item) => {
    sent.push(item)
    return 202
  })
  const options = (terminal) => ({
    url,
    terminal,
    token: 'fixture-' + terminal,
  })
  function terminalFile(id) {
    const key = createHash('sha256')
      .update(url + '\n' + id)
      .digest('hex')
    return path.join(dir, 'terminal-' + key + '.json')
  }
  const first = terminalFile('A'),
    second = terminalFile('B')
  const settingsFile = path.join(dir, 'agent-settings.json')
  fs.writeFileSync(
    settingsFile,
    JSON.stringify({
      url,
      terminal: 'B',
      collecting: false,
      secret: Buffer.from('fixture-B').toString('base64'),
      calendarFile: 'old.ics',
      calendarSecret: 'old-subscription',
      windowTitles: false,
    }),
  )
  const now = new Date().toISOString()
  for (const file of [first, second]) {
    const obsolete = { activity: 'active', foreground_app: 'obsolete-app' }
    const history = {
      messages: [],
      pending: [{ event_id: randomUUID(), state_key: 'desktop.activity', value: obsolete }],
      lastObserved: obsolete,
      lastSent: { at: now, value: obsolete },
    }
    const agenda = {
      events: [
        { title: 'private-event', start: now, end: now, all_day: false },
      ],
    }
    const id = randomUUID()
    const note = randomUUID()
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...history,
        lastAgenda: agenda,
        lastMaterial: { label: '日历安排', at: now },
        materials: [
          {
            id,
            kind: 'perception',
            source: 'calendar',
            label: '日历安排',
            body: {
              state_key: 'desktop.calendar',
              value: agenda,
              event_id: id,
              occurred_at: now,
            },
          },
          {
            id: note,
            kind: 'slice',
            label: '主动分享的文字',
            body: {
              event_id: note,
              text: '用户主动保存的会议笔记',
              occurred_at: now,
            },
          },
        ],
      }),
    )
  }
  const upgraded = launch()
  await until(() =>
    sent.some((item) => item.terminal === 'B' && item.route === '/v1/slices'),
  )
  const upgradedSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
  for (const key of ['calendarSecret', 'calendarFile', 'windowTitles'])
    assert.equal(Object.hasOwn(upgradedSettings, key), false)
  for (const file of [first, second])
    assert.doesNotMatch(
      fs.readFileSync(file, 'utf8'),
      /private-event|desktop\.calendar|lastAgenda|日历安排|obsolete-app/,
    )
  await upgraded.configure(options('A'))
  await until(() =>
    sent.some((item) => item.terminal === 'A' && item.route === '/v1/slices'),
  )
  for (const item of sent)
    assert.equal(item.body.text, '用户主动保存的会议笔记')
})
