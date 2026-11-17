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

// Advance the wall clock while continuing to observe the foreground. A single
// ten-minute jump would model a sleeping computer instead of an active visit.
async function observeFor(t, client, seconds) {
  while (seconds > 0) {
    const step = Math.min(seconds, 15)
    t.mock.timers.tick(step * 1000)
    await client.capture()
    seconds -= step
  }
}

test('one screenshot travels with the completed visit and retries unchanged after restart', async (t) => {
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
  const screenshot = () => ({ jpegBase64: jpeg })
  let client = launch(() => sample, screenshot)
  await client.configure({ url, terminal: 'desktop-A', token: 'fixture' })
  client.setCollection(true)
  await until(() => !client.profile.capturing)
  client.setScreenshots({ enabled: true })
  await client.capture()
  await observeFor(t, client, 600)
  const span = client.profile.history.windowSpan
  const [firstFrame] = span.frames
  assert.equal(span.frames.length, 1)
  const file = path.join(client.profile.mediaDirectory, 'periodic', firstFrame.id)
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
  assert.equal(request.body.value.duration_seconds, 600)
  assert.deepEqual(request.body.frames, [{
    occurred_at: firstFrame.occurred_at, window_title: '周会议程', jpeg_base64: jpeg,
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

test('browser tabs and windows share one screenshot after ten minutes; a later visit starts over', async t => {
  const start = Date.UTC(2026, 10, 17, 9)
  t.mock.timers.enable({ apis: ['Date'], now: start })
  const uploads = []
  const { launch, url } = await setup(t, item => { uploads.push(item); return 202 })
  const browser = (title, id) => ({
    activity: 'active', foreground_app: 'Chrome', window_title: title,
    target: { id, pid: 123456 },
  })
  let sample = browser('议程', '77')
  const shots = []
  const client = launch(() => sample, target => {
    shots.push([target.id, sample.window_title, (Date.now() - start) / 1000])
    return { jpegBase64: '/9j/2Q==' }
  })
  await client.configure({ url, terminal: 'workstation', token: 'fixture' })
  client.setCollection(true)
  await until(() => !client.profile.capturing)
  client.setScreenshots({ enabled: true })
  await client.capture()
  await observeFor(t, client, 299)
  sample = browser('设计文档', '88')
  await observeFor(t, client, 300)
  assert.deepEqual(shots, [])
  await observeFor(t, client, 1)
  sample = browser('项目进度', '77')
  await observeFor(t, client, 1200)
  assert.deepEqual(shots, [['88', '设计文档', 600]])
  assert.equal(uploads.length, 0)

  sample = { ...browser('草稿', '99'), foreground_app: 'Editor' }
  await client.capture()
  await observeFor(t, client, 599)
  sample = browser('复盘', '77')
  await client.capture()
  await observeFor(t, client, 600)
  assert.deepEqual(shots, [['88', '设计文档', 600], ['77', '复盘', 2999]])
  sample = { activity: 'locked' }
  await client.capture()
  await client.flushMaterials()
  await until(() => !client.profile.flushing && !client.state().pendingMaterials)
  assert.deepEqual(uploads.map(u => u.body.frames?.length || 0), [1, 0, 1])
  assert.deepEqual(uploads[0].body.value.work_objects.map(o => o.window_title), ['议程', '设计文档', '项目进度'])
  assert.equal(uploads[0].body.frames[0].window_title, '设计文档')
  assert.equal(uploads[1].body.value.duration_seconds, 599)
  assert.deepEqual(fs.readdirSync(path.join(client.profile.mediaDirectory, 'periodic')), [])
})

test('briefly leaving, sleeping, or turning screenshots off breaks continuous screenshot dwell', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 17, 9) })
  const { launch, url } = await setup(t, () => 202)
  const chrome = { activity: 'active', foreground_app: 'Chrome', target: { id: '77', pid: 123456 } }
  let sample = chrome
  let shots = 0
  const client = launch(() => sample, () => { shots++; return { jpegBase64: '/9j/2Q==' } })
  await client.configure({ url, terminal: 'desktop', token: 'test' })
  client.setCollection(true)
  await until(() => !client.profile.capturing)
  client.setScreenshots({ enabled: true })
  await client.capture()
  await observeFor(t, client, 599)
  sample = { ...chrome, foreground_app: 'Editor' }
  await client.capture()
  await observeFor(t, client, 2)
  sample = chrome
  await client.capture()
  await observeFor(t, client, 599)
  t.mock.timers.tick(3600000)
  await client.capture()
  await observeFor(t, client, 599)
  client.setScreenshots({ enabled: false })
  await observeFor(t, client, 20)
  client.setScreenshots({ enabled: true })
  await client.capture()
  await observeFor(t, client, 599)
  assert.equal(shots, 0)
  await observeFor(t, client, 1)
  assert.equal(shots, 1)
  client.setScreenshots({ enabled: false })
  client.setScreenshots({ enabled: true })
  await observeFor(t, client, 601)
  assert.equal(shots, 1)
})

test('switching apps while the native screenshot is being taken discards the image', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 17, 9) })
  const uploads = []
  const { launch, url } = await setup(t, item => { uploads.push(item); return 202 })
  const browser = { activity: 'active', foreground_app: 'Chrome', target: { id: '77', pid: 123456 } }
  let sample = browser
  let shots = 0
  const client = launch(() => sample, () => {
    shots++
    if (shots === 1) sample = { ...browser, foreground_app: 'Editor', target: { id: '88', pid: 654321 } }
    return { jpegBase64: '/9j/2Q==' }
  })
  await client.configure({ url, terminal: 'desktop', token: 'test' })
  client.setCollection(true)
  await until(() => !client.profile.capturing)
  client.setScreenshots({ enabled: true })
  await client.capture()
  await observeFor(t, client, 600)
  sample = browser
  await observeFor(t, client, 2)
  await observeFor(t, client, 610)
  sample = { activity: 'locked' }
  await client.capture()
  await client.flushMaterials()
  await until(() => !client.profile.flushing && !client.state().pendingMaterials)
  assert.equal(shots, 2)
  assert.deepEqual(uploads.map(item => item.body.value.foreground_app), ['Chrome', 'Editor', 'Chrome'])
  assert.equal(uploads[0].body.frames, undefined)
  assert.equal(uploads[1].body.value.duration_seconds, 2)
  assert.equal(uploads[2].body.frames.length, 1)
})

test('screenshot opt-out strips queued frames while retaining the dwell', async (t) => {
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
  p.history.materials.push(item)
  client.setScreenshots({ enabled: false })
  assert.ok(!fs.existsSync(file))
  const pending = p.history.materials.find(m => m.id === item.id)
  assert.ok(pending && !pending.frames?.length)
  assert.equal(p.history.materials.length, 1)
})

test('upgrade recovers one eligible frame from an interrupted legacy visit and preserves queued deliveries', async t => {
  const uploads = []
  const { dir, launch, url } = await setup(t, item => { uploads.push(item.body); return 202 })
  const terminal = 'desktop'
  const key = createHash('sha256').update(url + '\n' + terminal).digest('hex')
  const directory = path.join(dir, 'media-' + key, 'periodic')
  fs.mkdirSync(directory, { recursive: true })
  const at = s => new Date(Date.UTC(2026, 10, 17, 1) + s * 1000).toISOString()
  function frame(s) {
    const id = randomUUID()
    fs.writeFileSync(path.join(directory, id), Buffer.from([255, 216, 255, 217]))
    return { id, bytes: 4, occurred_at: at(s), segment: at(0) }
  }
  const queued = randomUUID(), interrupted = randomUUID()
  fs.writeFileSync(path.join(dir, 'agent-settings.json'), JSON.stringify({ url, terminal,
    secret: Buffer.from('test').toString('base64'), collecting: true, screenshotsEnabled: true, captureVersion: 6 }))
  fs.writeFileSync(path.join(dir, 'terminal-' + key + '.json'), JSON.stringify({
    materials: [{ id: queued, source: 'window', kind: 'perception', frames: [frame(10), frame(70)],
      body: { event_id: queued, state_key: 'desktop.window_span' } }],
    windowSpan: { id: interrupted, app: 'Chrome', start: at(0), lastSeen: at(750),
      frames: [frame(10)], titleRun: { samples: [frame(550), frame(610), frame(730)] } },
  }))
  const client = launch()
  await until(() => !client.profile.flushing && uploads.length === 2)
  assert.deepEqual(uploads.map(u => [u.event_id, u.frames.map(f => f.occurred_at)]),
    [[queued, [at(10), at(70)]], [interrupted, [at(610)]]])
  assert.deepEqual(fs.readdirSync(directory), [])
})

test('startup discards retired captures from every profile before any upload', async t => {
  const sent = []
  const { launch, url, dir } = await setup(t, item => { sent.push(item); return 202 })
  const terminals = ['A', 'B']
  const config = path.join(dir, 'agent-settings.json')
  fs.writeFileSync(config, JSON.stringify({ url, terminal: 'A', collecting: true,
    secret: Buffer.from('test').toString('base64'), browserSecret: 'retired', captureVersion: 5 }))
  const files = terminals.map(terminal => {
    const key = createHash('sha256').update(url + '\n' + terminal).digest('hex')
    const file = path.join(dir, 'terminal-' + key + '.json')
    const media = path.join(dir, 'media-' + key)
    const image = randomUUID()
    const audio = randomUUID()
    fs.mkdirSync(media)
    for (const id of [image, audio]) fs.writeFileSync(path.join(media, id), 'attachment')
    const span = randomUUID()
    fs.writeFileSync(file, JSON.stringify({ outbox: [], browserReceipts: ['old'],
      processing: [{ kind: 'image', id: image }], materials: [
        { source: 'browser', kind: 'perception', body: { state_key: 'browser.page' } },
        { source: 'shared', kind: 'slice', body: { text: 'selected text' } },
        { kind: 'slice', body: { text: 'manual text' } },
        { kind: 'image', id: image }, { kind: 'audio', id: audio },
        { source: 'window', kind: 'slice', body: { text: 'old dwell' } },
        { source: 'window', kind: 'perception', id: span, label: '前台停留',
          body: { event_id: span, state_key: 'desktop.window_span', value: {} } },
      ] }))
    return { file, media }
  })
  launch()
  await until(() => sent.some(item => item.route === '/v1/perceptions'))
  assert.deepEqual(sent.map(item => [item.terminal, item.route]), [['A', '/v1/perceptions']])
  assert.ok(!Object.hasOwn(JSON.parse(fs.readFileSync(config)), 'browserSecret'))
  for (const { file, media } of files) {
    const queue = JSON.parse(fs.readFileSync(file))
    assert.ok(!Object.hasOwn(queue, 'processing') && !Object.hasOwn(queue, 'browserReceipts'))
    assert.ok(queue.materials.every(item => item.body?.state_key === 'desktop.window_span'))
    assert.deepEqual(fs.readdirSync(media), [])
  }
})
