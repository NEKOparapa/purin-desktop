const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { DesktopAgent } = require('../electron/agent.cjs')

test('history uses the bound terminal and fetches an attachment only after Save', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wintermute-history-'))
  const requests = []
  const bytes = Buffer.from([255, 216, 0, 255, 217])
  const file = { id: 'evt_meeting', name: '周会截图.jpg' }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (
      req.headers.authorization !== 'Bearer meeting' ||
      req.headers['x-terminal-id'] !== 'desktop'
    ) {
      res.writeHead(401)
      return res.end()
    }
    if (url.pathname === '/v1/outputs') return res.end('{"outputs":[]}')
    requests.push(url)
    if (
      url.pathname === '/v1/schedule' &&
      url.searchParams.get('cursor') !== 'legacy'
    ) {
      return res.end(
        JSON.stringify({
          items: [
            {
              id: 'one',
              title: '复盘会议',
              content: null,
              trigger_at: '2026-11-16T04:00:00Z',
              status: 'scheduled',
              action: 'notify_agent',
            },
          ],
          next_cursor: null,
        }),
      )
    }
    if (url.pathname === '/v1/history') {
      if (url.searchParams.has('grouped') && url.searchParams.has('cursor')) {
        const oldServer = url.searchParams.get('cursor') === 'old-server'
        res.writeHead(oldServer ? 400 : 403)
        return res.end(
          JSON.stringify({ error: oldServer ? 'invalid_query' : 'forbidden' }),
        )
      }
      return res.end(
        JSON.stringify({
          items: [{ id: 'm', text: '周会', files: [file] }],
          next_cursor: null,
        }),
      )
    }
    if (url.pathname === '/v1/history/screenshot-groups/evt_run')
      return res.end(JSON.stringify({ items: [], next_cursor: null }))
    if (
      url.pathname.startsWith('/v1/history/compression') &&
      url.searchParams.get('cursor') !== 'legacy'
    )
      return res.end(JSON.stringify({ items: [], next_cursor: null }))
    if (url.pathname === '/v1/history/files/' + file.id) {
      res.writeHead(200, { 'Content-Length': bytes.length })
      return res.end(bytes)
    }
    if (url.pathname === '/v1/history/files/partial') {
      res.writeHead(200, { 'Content-Length': bytes.length + 10 })
      res.write(bytes, () => res.destroy())
      return
    }
    res.writeHead(404)
    res.end('{"error":"not_found"}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const agent = new DesktopAgent(
    dir,
    { encryptString: Buffer.from },
    async () => null,
    () => {},
  )
  t.after(async () => {
    agent.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(dir, { recursive: true, force: true })
  })
  await agent.configure({
    url: 'http://127.0.0.1:' + server.address().port,
    terminal: 'desktop',
    token: 'meeting',
  })
  const first = await agent.history({ view: 'timeline', cursor: 'page+1=' })
  assert.deepEqual(first.items[0].files, [file])
  assert.equal(requests[0].searchParams.get('view'), 'timeline')
  assert.equal(requests[0].searchParams.get('cursor'), 'page+1=')
  assert.deepEqual(await agent.downloadHistoryFile(file, async () => null), {
    saved: false,
  })
  assert.equal(requests.length, 1)
  const destination = path.join(dir, file.name)
  const result = await agent.downloadHistoryFile(
    { ...file, name: '../' + file.name },
    async (suggestion) => {
      assert.equal(suggestion, file.name)
      return destination
    },
  )
  assert.deepEqual(result, { saved: true })
  assert.deepEqual(await fs.readFile(destination), bytes)
  for (const id of ['partial', 'missing', '../other']) {
    await assert.rejects(
      agent.downloadHistoryFile({ ...file, id }, async () => destination),
    )
    assert.deepEqual(await fs.readFile(destination), bytes)
    assert.ok(!(await fs.readdir(dir)).some((name) => name.endsWith('.part')))
  }
  assert.equal(requests.length, 4)
  const before = requests.length
  await agent.history({ view: 'slice' })
  await agent.history({ view: 'slice', cursor: 'old-server' })
  await assert.rejects(agent.history({ view: 'slice', cursor: 'forbidden' }))
  await agent.history({ view: 'slice', groupId: 'evt_run', cursor: 'page+=2' })
  await assert.rejects(
    agent.history({ view: 'slice', groupId: '../files/other' }),
  )
  const [grouped, unsupported, fallback, forbidden, detail] =
    requests.slice(before)
  assert.equal(requests.length - before, 5)
  assert.equal(grouped.searchParams.get('grouped'), '1')
  assert.equal(unsupported.searchParams.get('grouped'), '1')
  assert.equal(fallback.searchParams.get('grouped'), null)
  assert.equal(fallback.searchParams.get('cursor'), 'old-server')
  assert.equal(forbidden.searchParams.get('grouped'), '1')
  assert.equal(detail.pathname, '/v1/history/screenshot-groups/evt_run')
  assert.equal(detail.searchParams.get('cursor'), 'page+=2')
  await agent.compression({
    kind: 'list',
    layer: 'perception',
    cursor: 'more+page',
  })
  await agent.compression({ kind: 'batch', id: '17' })
  await agent.compression({ kind: 'source', id: 'evt:unique', activity: true })
  const [list, batch, source] = requests.slice(-3)
  assert.equal(list.pathname, '/v1/history/compression')
  assert.equal(list.searchParams.get('layer'), 'perception')
  assert.equal(list.searchParams.get('cursor'), 'more+page')
  assert.equal(batch.pathname, '/v1/history/compression/17')
  assert.equal(source.pathname, '/v1/history/compression/sources/evt%3Aunique')
  assert.equal(source.searchParams.get('activity'), '1')
  await assert.rejects(
    agent.compression({ kind: 'list', layer: 'slice', cursor: 'legacy' }),
    /升级后端/,
  )
  await assert.rejects(
    agent.compression({ kind: 'source', id: '../files/nope' }),
  )
  const range = {
    start: '2026-11-01T00:00:00+08:00',
    end: '2026-12-01T00:00:00+08:00',
  }
  const schedule = await agent.schedule({ ...range, cursor: 'page+=2' })
  assert.equal(schedule.items[0].title, '复盘会议')
  const pathRead = requests.at(-1)
  assert.equal(pathRead.pathname, '/v1/schedule')
  assert.deepEqual(Object.fromEntries(pathRead.searchParams), {
    ...range,
    limit: '100',
    cursor: 'page+=2',
  })
  await assert.rejects(
    agent.schedule({ ...range, start: range.end }),
    /时间范围/,
  )
  await assert.rejects(
    agent.schedule({ ...range, cursor: 'legacy' }),
    /升级后端/,
  )
})
