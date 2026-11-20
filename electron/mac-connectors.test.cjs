const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const { DesktopAgent } = require('./agent.cjs')
const { macConnectors, runMacTool } = require('./mac-connectors.cjs')
const { TerminalToolClient } = require('./terminal-tools.cjs')

function platform(t, value) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { ...original, value })
  t.after(() => Object.defineProperty(process, 'platform', original))
}

const ids = ['mac_finder_selection', 'mac_notes_create', 'mac_music_control', 'mac_speak']
const signal = new AbortController().signal

for (const [system, expectedPlatform] of [['win32', 'windows'], ['linux', null], ['darwin', 'macos']]) {
  test(system + ' filters saved preferences, synchronization and active tools', async t => {
    platform(t, system)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wintermute-connectors-'))
    const sent = []
    const agent = Object.assign(Object.create(DesktopAgent.prototype), {
      dir, configFile: path.join(dir, 'settings.json'), notify() {},
    })
    t.after(() => { agent.close(); fs.rmSync(dir, { recursive: true, force: true }) })
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      sent.push({ route: new URL(url).pathname, body: JSON.parse(options.body || '{}'), headers: options.headers })
      return Response.json({ call: null })
    })
    agent.open({
      url: 'http://localhost', deviceId: 'desktop', deviceName: 'Desktop',
      installation: 'desktop-installation', macConnectorIds: [ids[0], 'ios_contacts'],
    }, 'token')
    assert.equal(agent.state().devicePlatform, expectedPlatform)
    await agent.connectors()
    const connectorRequest = sent.find(row => row.route === '/v1/connectors')
    assert.equal(connectorRequest.headers['X-Device-Platform'] ?? null, expectedPlatform)
    const p = agent.profile
    const toggle = (id, enabled) => agent.setMacConnector({ id, enabled, connectionRevision: p.revision })
    const apps = agent.state().macConnectors
    assert.deepEqual(apps.map(app => app.id), ids)
    if (system !== 'darwin') {
      assert.ok(apps.every(app => !app.enabled))
      assert.deepEqual(p.remote.activeTools(), [])
      assert.throws(() => toggle(ids[0], true))
      assert.equal((await runMacTool({ tool: ids[0], arguments: {}, timeout_seconds: 5 }, signal)).status, 'failed')
      assert.ok(!sent.some(({ body }) => ids.includes(body.id)))
      return
    }
    assert.deepEqual(apps.filter(app => app.enabled).map(app => app.id), [ids[0]])
    assert.deepEqual(p.remote.activeTools(), [ids[0]])
    assert.throws(() => toggle('ios_contacts', true))
    assert.throws(() => agent.setMacConnector({ id: ids[1], enabled: true, connectionRevision: 0 }))
    toggle(ids[1], true)
    toggle(ids[0], false)
    await agent.setObsidianConnector({ enabled: true, vaultPath: dir, connectionRevision: p.revision })
    assert.deepEqual(p.remote.activeTools().sort(), [ids[1], 'obsidian'].sort())
    await new Promise(resolve => setImmediate(resolve))
    const synced = sent.filter(row => row.route.endsWith('/device-sync')).map(row => row.body)
    assert.deepEqual(synced.findLast(row => row.id === ids[1]).config.tools, [ids[1]])
    assert.equal(synced.findLast(row => row.id === ids[0]).enabled, false)
    assert.deepEqual(JSON.parse(fs.readFileSync(agent.configFile)).macConnectorIds, [ids[1]])
    await p.remote.poll()
    assert.deepEqual(sent.findLast(row => row.route.endsWith('/claim')).body.tools.sort(), [ids[1], 'obsidian'].sort())
    // Rotating the credential for the same device starts a new authorization scope.
    agent.secure = { encryptString: value => Buffer.from(value) }
    agent.sync = agent.capture = () => {}
    await agent.configure({ url: p.url, deviceId: p.deviceId, deviceName: 'Mac', token: 'replacement' })
    assert.deepEqual(agent.profile.macConnectorIds, [])
  })
}

test('the native entry rejects unknown tools and invalid arguments before automation', async t => {
  platform(t, 'darwin')
  assert.ok(macConnectors().every(row => !row.enabled))
  for (const [tool, args] of [
    ['constructor', {}], [ids[0], { path: '/' }], [ids[1], { title: 'A', body: ' ' }],
    [ids[2], { action: 'play_url' }], [ids[3], { text: 'a'.repeat(201) }],
  ]) {
    const result = await runMacTool({ tool, arguments: args, timeout_seconds: 15 }, signal)
    assert.match(result.stderr, /参数/)
  }
})

test('bundled automation handles selections, literal note text, playback and speech', () => {
  const source = fs.readFileSync(path.join(__dirname, 'mac-automation.js'), 'utf8')
  let note, playback, speech
  const music = { running: () => true, playerState: () => 'playing',
    currentTrack: { name: () => '夜曲', artist: () => '歌手' }, pause: () => { playback = 'pause' } }
  const applications = {
    'com.apple.finder': { selection: () => Array.from({ length: 23 }, () => ({ name: () => '合同', kind: () => 'PDF' })) },
    'com.apple.Notes': { defaultAccount: () => ({ defaultFolder: () => ({ notes: { push: value => { note = value } } }) }), Note: value => value },
    'com.apple.Music': music,
  }
  const Application = id => applications[id]
  Application.currentApplication = () => ({ say: text => { speech = text } })
  const run = vm.runInNewContext(source + '\nrun', { Application })
  const invoke = (tool, args) => JSON.parse(run([JSON.stringify({ tool, args })]))
  const selection = invoke(ids[0], {})
  assert.equal(selection.items.length, 20)
  assert.ok(selection.truncated)
  assert.deepEqual(selection.items[0], { name: '合同', kind: 'PDF' })
  invoke(ids[1], { title: 'A&B', body: '<div>\r\n下一行' })
  assert.equal(note.body, '<div><b>A&amp;B</b></div><div>&lt;div&gt;<br>下一行</div>')
  assert.deepEqual(invoke(ids[2], { action: 'status' }), { state: 'playing', title: '夜曲', artist: '歌手' })
  invoke(ids[2], { action: 'pause' })
  assert.equal(playback, 'pause')
  music.running = () => false
  assert.deepEqual(invoke(ids[2], { action: 'status' }), { state: 'not_running' })
  invoke(ids[3], { text: '请休息一下' })
  assert.equal(speech, '请休息一下')
})

test('unadvertised tools cannot execute and disabling a running connector cancels it', async () => {
  let tool = 'mac_notes_create', receipt, entered
  const started = new Promise(resolve => { entered = resolve })
  const client = new TerminalToolClient({
    enabled: false, tools: [], extraTools: ['mac_speak'],
    handlers: {
      mac_notes_create: () => assert.fail('unadvertised handler ran'),
      mac_speak: (_call, running) => new Promise(resolve => {
        running.addEventListener('abort', () => resolve({ status: 'failed', stderr: 'cancelled' }))
        entered()
      }),
    },
    read: () => ({}), save() {}, onIssue() {},
    post: async (route, body) => {
      if (route.endsWith('/claim')) return { call: { id: 'call', claim_token: 'token', tool } }
      receipt = { ...body }
      return {}
    },
  })
  await client.poll()
  assert.equal(receipt.status, 'failed')
  tool = 'mac_speak'
  const active = client.poll()
  await started
  client.setExtraTools([], {})
  await active
  assert.equal(receipt.stderr, 'cancelled')
})
