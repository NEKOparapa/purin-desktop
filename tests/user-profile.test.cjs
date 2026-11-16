const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { DesktopAgent } = require('../electron/agent.cjs')

async function setup(t, onProfile) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wintermute-profile-'))
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/profile') return onProfile(req, res)
    if (req.url.startsWith('/v1/outputs')) return res.end('{"outputs":[]}')
    return res.end('{"items":[],"next_cursor":null}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const agent = new DesktopAgent(dir, { encryptString: Buffer.from }, async () => null, () => {})
  t.after(async () => {
    agent.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(dir, { recursive: true, force: true })
  })
  const configure = (token, terminal = 'desktop') => agent.configure({
    url: 'http://127.0.0.1:' + server.address().port, terminal, token,
  })
  return { agent, configure }
}

test('profile reads the current document on demand with the bound terminal credentials', async (t) => {
  const requests = []
  let response = { status: 'ready', markdown: '# 用户档案\n\n偏好简洁的回答。', effective: true, private: '不传到界面' }
  let statusCode = 200
  const { agent, configure } = await setup(t, (req, res) => {
    requests.push([req.method, req.headers.authorization, req.headers['x-terminal-id']])
    res.writeHead(statusCode)
    res.end(JSON.stringify(response))
  })
  await assert.rejects(agent.userProfile(), /请先连接终端/)
  await configure('first')
  assert.deepEqual(requests, [])
  assert.deepEqual(await agent.userProfile(), { status: 'ready', markdown: response.markdown, effective: true })
  assert.deepEqual(requests, [['GET', 'Bearer first', 'desktop']])
  response = { status: 'ready', markdown: '## 常用时间段\n- 工作日：上午', effective: false }
  assert.deepEqual(await agent.userProfile(), response)
  response = { status: 'empty', markdown: '## 基本信息\n- 昵称：', effective: false }
  assert.deepEqual(await agent.userProfile(), response)
  response = { status: 'empty', markdown: '' }
  const initial = await agent.userProfile()
  assert.equal(initial.status, 'empty')
  assert.equal(initial.effective, false)
  assert.deepEqual(initial.markdown.match(/^## .+$/gm),
    ['## 基本信息', '## 长期偏好', '## 日常习惯', '## 近期状态', '## 常用时间段'])
  assert.match(initial.markdown, /- 称呼：/)
  assert.match(initial.markdown, /- 周末常见活跃时段：/)
  response = { status: 'unconfigured', markdown: '' }
  assert.deepEqual(await agent.userProfile(), { ...response, effective: false })
  response = { status: 'ready', markdown: '内容', effective: 'false' }
  await assert.rejects(agent.userProfile(), /格式无效/)
  response = { status: 'ready', markdown: {} }
  await assert.rejects(agent.userProfile(), /格式无效/)
  statusCode = 404
  await assert.rejects(agent.userProfile(), /当前后端不支持用户档案/)
  statusCode = 403
  await assert.rejects(agent.userProfile(), /HTTP 403/)
})

test('changing credentials invalidates an in-flight profile even at the same URL and terminal', async (t) => {
  let started
  const firstRead = new Promise(resolve => { started = resolve })
  const { agent, configure } = await setup(t, (req, res) => {
    if (req.headers.authorization === 'Bearer first') {
      started()
      return
    }
    res.end(JSON.stringify({ status: 'ready', markdown: '# 第二份档案' }))
  })
  await configure('first')
  const revision = agent.state().connectionRevision
  const stale = assert.rejects(agent.userProfile(), /连接已更改/)
  await firstRead
  await configure('second')
  await stale
  assert.ok(agent.state().connectionRevision > revision)
  assert.deepEqual(await agent.userProfile(), { status: 'ready', markdown: '# 第二份档案', effective: null })
})
