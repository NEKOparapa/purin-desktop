const assert = require('node:assert/strict')
const test = require('node:test')
const { DesktopAgent } = require('./agent.cjs')

test('retrying an invitation sends the same client identity and credential', async t => {
  const profile = { installation: 'test-installation', deviceName: '书房电脑' }
  const agent = Object.assign(Object.create(DesktopAgent.prototype), {
    profile,
    async configure({ deviceId, token }) {
      assert.equal(deviceId, sent[0].id)
      assert.equal(token, sent[0].token)
    },
  })
  const sent = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://unit.test/v1/devices/pair')
    const body = JSON.parse(options.body)
    assert.equal(body.device_name, profile.deviceName)
    assert.equal(body.installation, profile.installation)
    assert.equal(body.code, '1234567890')
    const id = options.headers['X-Device-ID']
    assert.match(id, /^desktop-[a-f0-9]{24}$/)
    if (process.platform === 'win32') assert.equal(options.headers['X-Device-Platform'], 'windows')
    sent.push({ id, token: body.token })
    if (sent.length === 1) throw new Error('response lost')
    return Response.json({ device_id: id })
  })
  const invitation = { value: 'https://unit.test/#purin-pair=12345-67890' }
  await assert.rejects(
    agent.pair({ value: '12345-67890', serverUrl: 'https://unit.test' }),
    /完整配对链接/,
  )
  assert.equal(sent.length, 0)
  await assert.rejects(agent.pair(invitation), /response lost/)
  await agent.pair(invitation)
  assert.deepEqual(sent[1], sent[0])
})

test('onlineDevices fetches online device list when configured', async t => {
  const unconfigured = Object.assign(Object.create(DesktopAgent.prototype), {
    profile: { token: '', controller: new AbortController() },
  })
  assert.deepEqual(await unconfigured.onlineDevices(), { items: [] })

  const controller = new AbortController()
  const configured = Object.assign(Object.create(DesktopAgent.prototype), {
    profile: {
      url: 'https://unit.test',
      deviceId: 'desktop-test',
      deviceName: '书房电脑',
      installation: 'test-installation-1234',
      token: 'secret-token',
      controller,
    },
  })
  const expected = [
    {
      device_id: 'desktop-test',
      name: '书房电脑',
      device_type: 'desktop',
      platform: 'windows',
      last_seen_seconds: 0,
      is_current: true,
    },
  ]
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://unit.test/v1/devices/online')
    assert.equal(options.method, 'GET')
    assert.equal(options.headers.Authorization, 'Bearer secret-token')
    return Response.json({ items: expected })
  })
  assert.deepEqual(await configured.onlineDevices(), { items: expected })
})
