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
  const [firstFrame] = span.titleRun.samples
  assert.equal(span.titleRun.samples.length, 1)
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
  assert.equal(request.body.value.duration_seconds, 20)
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

test('one visit with two long titles uploads first, middle and last of each, skipping a short tab', async t => {
  const start = Date.UTC(2026, 10, 17, 9)
  t.mock.timers.enable({ apis: ['Date'], now: start })
  const uploads = []
  const { launch, url } = await setup(t, item => {
    uploads.push(item)
    assert.equal(item.route, '/v1/perceptions/desktop-window/batches')
    const { offset, frames, total_frames } = item.body
    return { status: 202, json: offset + frames.length === total_frames
      ? { event_id: 'visit' } : { next_offset: offset + frames.length } }
  })
  let title = '周会议程'
  const shots = []
  const target = { id: '77', pid: 123456 }
  const client = launch(() => title
    ? { activity: 'active', foreground_app: 'Editor', window_title: title, target }
    : { activity: 'locked' }, () => {
    shots.push([title, (Date.now() - start) / 1000])
    return { jpegBase64: '/9j/2Q==' }
  })
  await client.configure({ url, terminal: 'workstation', token: 'fixture' })
  client.setCollection(true)
  await until(() => !client.profile.capturing)
  client.setScreenshots({ enabled: true })
  await client.capture()
  for (let s = 1; s <= 738; s++) {
    t.mock.timers.tick(1000)
    if (s === 525) title = '邮箱'
    if (s === 529) title = '风险清单'
    if (s === 738) title = ''
    await client.capture()
  }
  assert.deepEqual(shots.filter(([name]) => name === '周会议程').map(([, s]) => s),
    [10, 70, 130, 190, 250, 310, 370, 430, 490])
  assert.ok(shots.every(([name]) => name !== '邮箱'))
  await client.flushMaterials()
  await until(() => !client.profile.flushing && !client.state().pendingMaterials)
  const parts = uploads.map(item => item.body)
  assert.deepEqual(parts.map(p => p.offset), [0, 3])
  assert.equal(new Set(parts.map(p => p.manifest)).size, 1)
  assert.equal(new Set(parts.map(p => p.event_id)).size, 1)
  assert.deepEqual(parts.flatMap(p => p.frames.map(f => (Date.parse(f.occurred_at) - start) / 1000)),
    [10, 250, 490, 539, 659, 719])
  assert.deepEqual(fs.readdirSync(path.join(client.profile.mediaDirectory, 'periodic')), [])
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
  client.setScreenshots({ enabled: false, minutes: 5 })
  assert.ok(!fs.existsSync(file))
  const pending = p.history.materials.find(m => m.id === item.id)
  assert.ok(pending && !pending.frames?.length)
  assert.equal(p.history.materials.length, 1)
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
