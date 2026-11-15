const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { deliverPending } = require('../electron/notifications.cjs')
const { DesktopAgent } = require('../electron/agent.cjs')

const notice = (id, more = {}) => ({
  id,
  title: '会议资料',
  body: '查看附件',
  created_at: '2026-11-16T05:00:00Z',
  attachments: [],
  ...more,
})
test('retries failed receipts after restart without re-alerting, silently acknowledges expiry', async () => {
  const items = [notice('one'), notice('expired', { expired: true })]
  let inFlight = [],
    stored = [],
    alerts = 0,
    fail = true
  const ack = []
  async function poll() {
    await deliverPending({
      inFlight,
      active: () => true,
      save: () => {
        stored = [...inFlight]
      },
      present: (fresh) => {
        ++alerts
        assert.deepEqual(
          fresh.map((n) => n.id),
          ['one'],
        )
      },
      request: async (route, body) => {
        if (!body) {
          assert.match(route, /pending=1/)
          return { items, next_cursor: null }
        }
        if (fail) {
          fail = false
          throw Error('network lost')
        }
        ack.push(route.split('/')[3])
        return {}
      },
    })
  }
  await assert.rejects(poll(), /network lost/)
  inFlight = [...stored]
  await poll()
  assert.equal(alerts, 1)
  assert.deepEqual(ack, ['one', 'expired'])
  assert.deepEqual(stored, [])
})

test('only downloads chosen device notification file after confirming its destination', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wm-inbox-test-'))
  const requests = []
  const a = {
    id: 'file-a',
    name: '会议资料.pdf',
    size_bytes: 5,
    content_type: 'application/pdf',
  }
  const b = {
    id: 'file-b',
    name: '议程.txt',
    size_bytes: 3,
    content_type: 'text/plain',
  }
  const server = http.createServer((req, res) => {
    if (
      req.headers['x-terminal-id'] !== 'desktop' ||
      req.headers.authorization !== 'Bearer fixture'
    ) {
      res.writeHead(401)
      return res.end('{}')
    }
    const { pathname } = new URL(req.url, 'http://localhost')
    if (pathname === '/v1/notifications')
      return res.end(
        JSON.stringify({
          items: [notice('n1', { attachments: [a, b] })],
          next_cursor: null,
        }),
      )
    if (pathname.includes('/files/')) {
      requests.push(pathname)
      return res.end('ABC')
    }
    if (pathname === '/v1/outputs') return res.end('{"outputs":[]}')
    return res.end('{"items":[],"next_cursor":null}')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const agent = new DesktopAgent(
    dir,
    { encryptString: Buffer.from },
    async () => null,
    () => {},
  )
  t.after(async () => {
    agent.close()
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
    await fs.rm(dir, { recursive: true, force: true })
  })
  await agent.configure({
    url: 'http://127.0.0.1:' + server.address().port,
    terminal: 'desktop',
    token: 'fixture',
  })
  const page = await agent.notificationPage()
  assert.deepEqual(page.items[0].attachments, [a, b])
  const file = { notificationId: 'n1', file: b }
  assert.deepEqual(
    await agent.downloadNotificationFile(file, async () => null),
    { saved: false },
  )
  assert.deepEqual(requests, [])
  const dest = path.join(dir, 'picked.txt')
  await agent.downloadNotificationFile(file, async (name) => {
    assert.equal(name, '议程.txt')
    return dest
  })
  assert.deepEqual(requests, ['/v1/notifications/n1/files/file-b'])
  assert.equal(await fs.readFile(dest, 'utf8'), 'ABC')
  assert.throws(() =>
    agent.downloadNotificationFile(
      { ...file, notificationId: '../outside' },
      async () => dest,
    ),
  )
})
