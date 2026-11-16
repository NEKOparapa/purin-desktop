const assert = require('node:assert/strict')
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { DesktopAgent } = require('../electron/agent.cjs')

test('model key bridge only forwards current-connection edits and returns masked metadata', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wm-key-bridge-'))
  let masked = '••••1234'
  const item = () => ({ id: 'vision', usages: ['截图识别'], configured: true, masked })
  const requests = []
  let status = 200
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/v1/outputs')) return res.end('{"outputs":[]}')
    if (req.url !== '/v1/settings/api-keys') return res.end('{"items":[],"next_cursor":null}')
    const chunks = []
    for await (const part of req) chunks.push(part)
    const payload = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined
    requests.push([req.method, req.headers.authorization, payload])
    if (payload) masked = '••••' + payload.api_key.slice(-4)
    res.writeHead(status)
    res.end(JSON.stringify(status === 200
      ? { items: [{ ...item(), unexpected: 'full-credential' }] }
      : { error: 'do_not_leak_me' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const agent = new DesktopAgent(dir, { encryptString: Buffer.from }, async () => null, () => {})
  t.after(async () => {
    agent.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  })
  const config = { url: 'http://127.0.0.1:' + server.address().port, terminal: 'desktop' }
  await assert.rejects(agent.apiKeys(), /请先连接终端/)
  await agent.configure({ ...config, token: 'first' })
  assert.deepEqual(await agent.apiKeys(), [item()])
  const draft = { id: 'vision', apiKey: 'synthetic-value-5678', connectionRevision: agent.state().connectionRevision }
  assert.deepEqual(await agent.updateApiKey(draft), [item()])
  assert.deepEqual(requests, [
    ['GET', 'Bearer first', undefined],
    ['POST', 'Bearer first', { id: 'vision', api_key: draft.apiKey }],
  ])
  assert.ok(!JSON.stringify(agent.state()).includes(draft.apiKey))
  for (const file of await readdir(dir)) {
    if (file.endsWith('.json'))
      assert.ok(!(await readFile(path.join(dir, file), 'utf8')).includes(draft.apiKey))
  }
  await agent.configure({ ...config, token: 'second' })
  await assert.rejects(agent.updateApiKey(draft), /连接已更改/)
  assert.equal(requests.length, 2)
  masked = 'unmasked-secret'
  await assert.rejects(agent.apiKeys(), /格式无效/)
  status = 403
  await assert.rejects(agent.apiKeys(), { message: '此终端没有管理接口密钥的权限' })
})

test('remote cleartext key management stops before network I/O', async () => {
  for (const hostname of ['192.168.0.9', 'localhost.example', '127.0.0.1.example']) {
    const agent = Object.create(DesktopAgent.prototype)
    agent.profile = { url: 'http://' + hostname, token: 'fixture', revision: 2 }
    await assert.rejects(agent.apiKeys(), /HTTPS 或本机连接/)
    await assert.rejects(agent.updateApiKey({ connectionRevision: 2, id: 'main', apiKey: 'fixture' }), /HTTPS 或本机连接/)
  }
})
