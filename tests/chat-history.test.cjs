const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ChatHistory } = require('../electron/chat-history.cjs')

const row = (id, role, occurred_at = null) => ({
  id,
  role,
  text: id,
  occurred_at,
})
test('a reset to different records replaces all expanded pages, even when the page is full', async () => {
  const chat = new ChatHistory()
  let head = [row('2', 'assistant'), row('1', 'user')]
  const api = async (path) =>
    path.includes('cursor=')
      ? { items: [row('0', 'user')], next_cursor: null }
      : { items: head, next_cursor: 'older' }
  await chat.read(api)
  await chat.read(api, true)
  head = [row('3', 'assistant'), head[0]]
  await chat.read(api)
  assert.deepEqual(
    chat.messages.map((m) => m.id),
    ['0', '1', '2', '3'],
  )
  head = [row('new-2', 'user'), row('new-1', 'user')]
  await chat.read(api)
  assert.deepEqual(
    chat.messages.map((m) => m.id),
    ['new-1', 'new-2'],
  )
  await assert.rejects(
    chat.read(async () => {
      throw Error('offline')
    }),
  )
  assert.deepEqual(
    chat.messages.map((m) => m.id),
    ['new-1', 'new-2'],
  )
})

test('old server pages past internal notifications and returns the actual agent reply once', async () => {
  let cleared = false,
    probes = 0
  const api = async (path) => {
    const query = new URL(path, 'http://localhost').searchParams
    if (query.get('view') === 'dialogue') {
      probes++
      throw Object.assign(Error('old server'), {
        status: 400,
        code: 'invalid_query',
      })
    }
    if (query.get('view') === 'conversation' || cleared)
      return { items: [], next_cursor: null }
    if (!query.has('cursor'))
      return {
        items: [row('private', 'user', '2026-11-16T04:00:00Z')],
        next_cursor: 'more',
      }
    return {
      items: [
        row('alarm', 'assistant'),
        row('internal', 'user', '2026-11-16T03:59:00Z'),
      ],
      next_cursor: null,
    }
  }
  const chat = new ChatHistory()
  await chat.read(api)
  assert.deepEqual(chat.messages, [])
  assert.equal(chat.hasEarlier, true)
  await chat.read(api, true)
  await chat.read(api)
  assert.deepEqual(
    chat.messages.map((m) => m.id),
    ['alarm'],
  )
  assert.equal(chat.messages[0].role, 'assistant')
  assert.equal(chat.messages[0].notificationReply, true)
  cleared = true
  await chat.read(api)
  assert.deepEqual(chat.messages, [])
  assert.equal(probes, 1)
})

test('an open client discovers a server upgrade on a later head poll and keeps cursors scoped', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 })
  const chat = new ChatHistory()
  let upgraded = false,
    probes = 0
  const api = async (url) => {
    const params = new URL(url, 'http://localhost').searchParams
    const view = params.get('view')
    const cursor = params.get('cursor')
    if (view === 'dialogue') {
      probes++
      assert.equal(cursor, null)
      if (!upgraded)
        throw Object.assign(Error('old server'), {
          status: 400,
          code: 'invalid_query',
        })
      return { items: [row('new reply', 'assistant')], next_cursor: null }
    }
    if (view === 'notification') return { items: [], next_cursor: null }
    if (cursor) assert.equal(cursor, 'conversation-page-2')
    return {
      items: [row(cursor ? 'earlier' : 'old', 'user')],
      next_cursor: cursor ? null : 'conversation-page-2',
    }
  }
  await chat.read(api)
  upgraded = true
  t.mock.timers.tick(59_999)
  await chat.read(api)
  t.mock.timers.tick(1)
  await chat.read(api, true)
  assert.equal(probes, 1)
  assert.deepEqual(
    chat.messages.map((m) => m.id),
    ['earlier', 'old'],
  )
  await chat.read(api)
  assert.equal(probes, 2)
  assert.deepEqual(
    chat.messages.map((m) => m.id),
    ['new reply'],
  )
})
