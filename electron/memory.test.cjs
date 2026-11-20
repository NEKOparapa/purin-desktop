const { test } = require('node:test')
const assert = require('node:assert/strict')
const memory = require('./memory.cjs')
const { DesktopAgent } = require('./agent.cjs')
const id = 'rec_' + 'a'.repeat(32)

test('memory paths stay relative; file names are encoded as query values', () => {
  assert.equal(new URL(memory.fileRoute('note/归档/a & b.md'), 'https://test').searchParams.get('path'), 'note/归档/a & b.md')
  for (const path of ['../secret.md', '/etc/x.md', 'note/.trash/x.md', 'note/a\\b.md', 'C:/a.md', 'note/a\0.md', 'note/a.txt'])
    assert.throws(() => memory.fileRoute(path))
  const tree = memory.validateTree({ files: [
    { path: 'note/archive', is_dir: true, bytes: 0, updated_at: '2026-11-19T08:00:00Z' },
    { path: 'note/archive/旧项目.md', is_dir: false, bytes: 30, updated_at: '2026-11-19T08:00:00Z' },
  ] })
  assert.deepEqual(tree.map(file => file.path), ['note/archive/旧项目.md'])
  assert.throws(() => memory.validateFile({ path: 'about-user/profile.md', content: 'wrong', content_sha256: 'a'.repeat(16) }, 'note/x.md'))
})

test('record filters and cursors cannot alter the route', () => {
  const query = new URL(memory.recordsRoute({ recordType: 'sms', cursor: id }), 'https://test').searchParams
  assert.equal(query.get('record_type'), 'sms')
  assert.equal(query.get('cursor'), id)
  assert.throws(() => memory.recordsRoute({ recordType: 'anything' }))
  assert.throws(() => memory.recordsRoute({ cursor: '../memory' }))
  assert.throws(() => memory.contentRoute({ id, offset: -1 }))
  assert.throws(() => memory.contentRoute({ id: '../x' }))
  assert.throws(() => memory.validateRecords({ items: [{ item_id: id }], next_cursor: null }))
})

test('record content offsets count Unicode code points and reject broken pages', () => {
  const page = { item_id: id, offset: 0, text: '😀中文', format: 'text', total_chars: 5, next_offset: 3 }
  assert.equal(memory.validateContent(page, { id }).next_offset, 3)
  assert.throws(() => memory.validateContent({ ...page, next_offset: 4 }, { id }))
  assert.throws(() => memory.validateContent({ ...page, next_offset: null }, { id }))
  assert.throws(() => memory.validateContent(page, { id, offset: 1 }))
})

test('a connection change discards in-flight memory responses', async () => {
  const originalFetch = global.fetch
  const profile = { token: 'test', url: 'https://test.invalid', deviceId: 'test', controller: new AbortController() }
  const agent = Object.create(DesktopAgent.prototype)
  agent.profile = profile
  let respond
  global.fetch = () => new Promise(resolve => { respond = resolve })
  try {
    const pending = agent.memoryTree()
    agent.profile = { ...profile }
    respond(new Response(JSON.stringify({ files: [] }), { headers: { 'Content-Type': 'application/json' } }))
    await assert.rejects(pending, /连接已更改/)
  } finally { global.fetch = originalFetch }
})

test('memory schedule autosaves are applied in order before a new page reads the plan', async t => {
  const agent = Object.create(DesktopAgent.prototype)
  agent.profile = {
    token: 'test', url: 'https://test.invalid', deviceId: 'test', revision: 1,
    controller: new AbortController(),
  }
  const firstStarted = Promise.withResolvers()
  const finishFirst = Promise.withResolvers()
  const requests = []
  let plan = { interval_days: 1, local_time: '03:00', timezone: 'Asia/Shanghai', next_run_at: '2026-11-22T03:00:00+08:00' }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).pathname, '/v1/memory/schedule')
    const input = options.method === 'POST' ? JSON.parse(options.body) : null
    requests.push(input ?? 'read')
    if (requests.length === 1) {
      firstStarted.resolve()
      await finishFirst.promise
    }
    if (input) plan = { ...plan, ...input }
    return Response.json(plan)
  })

  const firstValues = { interval_days: 12, local_time: '03:00' }
  const finalValues = { interval_days: 15, local_time: '05:30' }
  const first = agent.memorySchedule({ ...firstValues, connectionRevision: 1 })
  await firstStarted.promise
  const second = agent.memorySchedule({ ...finalValues, connectionRevision: 1 })
  const reopened = agent.memorySchedule()
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(requests, [firstValues])
  } finally {
    finishFirst.resolve()
  }
  const [firstPlan, finalPlan, reopenedPlan] = await Promise.all([first, second, reopened])
  assert.deepEqual(requests, [firstValues, finalValues, 'read'])
  assert.equal(firstPlan.interval_days, 12)
  assert.deepEqual(reopenedPlan, finalPlan)
  assert.equal(reopenedPlan.interval_days, 15)
  assert.equal(reopenedPlan.local_time, '05:30')
})
