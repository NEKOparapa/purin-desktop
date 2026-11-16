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

test('closed window and selected frames travel as one perception and retry together after restart', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 14, 1) })
  const uploads = []
  let online = false
  const { launch, url } = await setup(t, (item) => {
    uploads.push(item)
    return item.route === '/v1/perceptions/desktop-window' && !online ? 404 : 202
  })
  const window = {
    activity: 'active', foreground_app: '编辑器', window_title: '周会议程',
    target: { platform: 'windows', id: '251', pid: 123456 },
  }
  let sample = window
  const jpeg = Buffer.from([255, 216, 255, 217]).toString('base64')
  const screenshot = () => ({ jpegBase64: jpeg, signature: Buffer.alloc(64 * 48, 90) })
  let client = launch(() => sample, screenshot)
  await client.configure({ url, terminal: 'desktop-A', token: 'fixture' })
  client.setCollection(true)
  await until(() => !client.profile.capturing)
  client.setScreenshots({ enabled: true, minutes: 1 })
  await client.capture()
  t.mock.timers.tick(5000)
  await client.capture()
  t.mock.timers.tick(15000)
  await client.capture()
  const span = client.profile.history.windowSpan
  assert.equal(span.frames.length, 1)
  const file = path.join(client.profile.mediaDirectory, 'periodic', span.frames[0].id)
  assert.ok(fs.existsSync(file))
  assert.equal(uploads.length, 0)

  sample = { activity: 'locked' }
  await client.capture()
  await client.flushMaterials()
  await until(() => !client.profile.flushing && !!client.state().failedMaterial)
  assert.match(client.state().materialIssue, /升级/)
  assert.ok(fs.existsSync(file))
  const [request] = uploads
  assert.equal(request.route, '/v1/perceptions/desktop-window')
  assert.equal(request.body.event_id, span.id)
  assert.equal(request.body.state_key, 'desktop.window_span')
  assert.equal(request.body.value.foreground_app, '编辑器')
  assert.equal(request.body.value.duration_seconds, 20)
  assert.deepEqual(request.body.frames, [{
    occurred_at: span.frames[0].occurred_at, window_title: '周会议程', jpeg_base64: jpeg,
  }])
  client.close()
  client = launch(() => sample, screenshot)
  await until(() => !client.profile.capturing && !client.profile.flushing)
  online = true
  client.manageFailed({ id: span.id, retry: true })
  await until(() => !fs.existsSync(file) && !client.state().pendingMaterials)
  assert.equal(uploads.length, 2)
  assert.deepEqual(uploads[1].body, request.body)
  assert.deepEqual(uploads.map((item) => item.route), Array(2).fill('/v1/perceptions/desktop-window'))
})

test('screenshot opt-out strips queued frames while retaining the dwell and explicit shares', async (t) => {
  const { launch, url } = await setup(t, () => 503)
  const client = launch()
  await client.configure({ url, terminal: 'desktop', token: 'fixture' })
  client.setCollection(true)
  const p = client.profile
  const end = new Date().toISOString()
  const item = { id: randomUUID(), kind: 'perception', source: 'window', label: '前台停留',
    body: { state_key: 'desktop.window_span', occurred_at: end, value: { foreground_app: 'app' } },
    frames: [{ id: randomUUID(), occurred_at: end, bytes: 4 }], retryAt: Date.now() + 60000 }
  item.body.event_id = item.id
  const directory = path.join(p.mediaDirectory, 'periodic')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, item.frames[0].id)
  fs.writeFileSync(file, Buffer.from([255,216,255,217]))
  client.addMaterial(p, item)
  client.shareMaterial({ kind: 'image', jpegBase64: '/9j/2Q==', occurredAt: end })
  client.setScreenshots({ enabled: false, minutes: 5 })
  assert.ok(!fs.existsSync(file))
  const pending = p.history.materials.find(m => m.id === item.id)
  assert.ok(pending && !pending.frames?.length)
  assert.ok(p.history.materials.find(m => m.kind === 'image'))
})

test('upgrade attaches an old automatic screenshot only to its own queued dwell', async (t) => {
  const sent = []
  const { launch, dir, url } = await setup(t, (item) => { sent.push(item); return 202 })
  const terminal = 'desktop-offline'
  const key = createHash('sha256').update(url + '\n' + terminal).digest('hex')
  const id = randomUUID()
  const at = '2026-11-16T01:00:10.000Z'
  const valid = { id: randomUUID(), kind: 'image', source: 'screenshot', at,
    context: { activity_id: id, title: '项目周会' } }
  const orphan = { ...valid, id: randomUUID(), context: { activity_id: randomUUID() } }
  const periodic = path.join(dir, 'media-' + key, 'periodic')
  fs.mkdirSync(periodic, { recursive: true })
  for (const image of [valid, orphan]) fs.writeFileSync(path.join(periodic, image.id), Buffer.from([255,216,255,217]))
  fs.writeFileSync(path.join(dir, 'agent-settings.json'), JSON.stringify({
    url, terminal, collecting: true, screenshotsEnabled: true, captureVersion: 4,
    secret: Buffer.from('test').toString('base64'),
  }))
  const dwell = { id, source: 'window', kind: 'perception', body: {
    event_id: id, occurred_at: at, state_key: 'desktop.window_span', value: {
      foreground_app: 'Editor', window_title: '项目周会', started_at: '2026-11-16T01:00:00.000Z',
      ended_at: at, duration_seconds: 10,
    },
  } }
  fs.writeFileSync(path.join(dir, 'terminal-' + key + '.json'), JSON.stringify({ materials: [valid, orphan, dwell] }))
  const client = launch()
  await until(() => !client.state().pendingMaterials && fs.readdirSync(periodic).length === 0)
  assert.deepEqual(sent.map(item => item.route), ['/v1/perceptions/desktop-window'])
  assert.equal(sent[0].body.event_id, id)
  assert.equal(sent[0].body.frames.length, 1)
  assert.equal(sent[0].body.frames[0].window_title, '项目周会')
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
