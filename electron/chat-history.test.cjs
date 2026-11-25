const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { DesktopAgent } = require('./agent.cjs')
const { ChatHistory } = require('./chat-history.cjs')

test('mascot reacts to incoming replies once, excluding startup history and pagination', async () => {
  const chat = new ChatHistory()
  const reply = id => ({ id, role: 'assistant', text: id })
  const load = (items, next_cursor = null) => async () => ({ items, next_cursor })
  await chat.read(load([reply('old')], 'older'))
  await chat.read(load([reply('older')]), true)
  assert.equal(chat.replyReceivedAt, 0)
  await chat.read(load([reply('new'), reply('old')], 'older'))
  const arrival = chat.replyReceivedAt
  assert.ok(arrival > 0)
  await chat.read(load([reply('new'), reply('old')], 'older'))
  assert.equal(chat.replyReceivedAt, arrival)
  chat.sent('another-turn')
  await chat.read(load([reply('new'), reply('old')], 'older'))
  assert.equal(chat.replyReceivedAt, 0)
})

test('a reply to a new local send can arrive with the initial history', async () => {
  const chat = new ChatHistory()
  chat.sent('first')
  await chat.read(async () => ({ items: [
    { id: 'response', role: 'assistant', text: '你好' },
    { id: 'request', role: 'user', message_id: 'first', text: '嗨' },
  ], next_cursor: null }))
  assert.ok(chat.replyReceivedAt > 0)
})

function openChat(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purin-chat-history-'))
  const snapshots = []
  const server = { messages: [], job: 'running', sent: null }
  const agent = Object.assign(Object.create(DesktopAgent.prototype), {
    dir,
    notify: state => snapshots.push(structuredClone(state.messages)),
  })
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    switch (new URL(url).pathname) {
      case '/v1/messages':
        server.sent = JSON.parse(options.body)
        return Response.json({ event_id: 'evt_first', job_id: 'job_first' })
      case '/v1/history':
        assert.equal(new URL(url).searchParams.get('view'), 'dialogue')
        return Response.json({ items: server.messages, next_cursor: null })
      case '/v1/jobs/job_first':
        return Response.json({ status: server.job })
      case '/v1/outputs':
        return Response.json({ outputs: [] })
      case '/v1/questions':
        return Response.json({ items: [] })
      default:
        assert.fail(`Unexpected request: ${url}`)
    }
  })
  agent.open({ url: 'http://purin.invalid', deviceId: 'desktop' }, 'test-token')
  t.after(() => {
    agent.close()
    if (fs.existsSync(agent.profile.file)) fs.unlinkSync(agent.profile.file)
    fs.rmdirSync(dir)
  })
  return { agent, snapshots, server }
}

function historyMessage(sent) {
  return {
    id: 'evt_first',
    role: 'user',
    text: sent.text,
    occurred_at: '2026-11-21T00:00:00Z',
    device_id: 'desktop',
    message_id: sent.message_id,
  }
}

test('the first message stays visible when the job completes before history returns it', async t => {
  const { agent, snapshots, server } = openChat(t)
  await agent.sync()
  assert.deepEqual(agent.state().messages, [])

  const sync = agent.sync.bind(agent)
  let sending
  agent.sync = () => { sending = sync() }
  server.job = 'completed'
  agent.send('第一句话')
  await sending

  const id = server.sent.message_id
  assert.deepEqual(snapshots.map(page => page.map(row => row.id)), [[id], [id], [id]])
  assert.deepEqual(snapshots.map(page => page[0].status), ['queued', 'waiting', 'completed'])
  const saved = JSON.parse(fs.readFileSync(agent.profile.file, 'utf8')).outbox
  assert.equal(saved[0].id, id)

  server.messages = [historyMessage(server.sent)]
  await sync()
  assert.deepEqual(agent.profile.history.outbox, [])
  const [merged] = agent.state().messages
  assert.equal(agent.state().messages.length, 1)
  assert.equal(merged.id, id)
  assert.equal(merged.at, server.messages[0].occurred_at)
  assert.equal(merged.status, undefined)

  server.messages = []
  await sync()
  assert.deepEqual(agent.state().messages, [])
})

test('history can merge a waiting message before its job completes', async t => {
  const { agent, server } = openChat(t)
  const sync = agent.sync.bind(agent)
  let sending
  agent.sync = () => { sending = sync() }
  agent.send('另一条消息')
  await sending

  const id = server.sent.message_id
  assert.deepEqual(agent.state().messages.map(row => [row.id, row.status]), [[id, 'waiting']])

  const message = historyMessage(server.sent)
  server.messages = [
    { ...message, id: 'evt_other_device', device_id: 'other-device' },
    message,
  ]
  await sync()
  assert.deepEqual(agent.state().messages.map(row => [row.id, row.status]), [
    [id, 'waiting'], ['evt_other_device', undefined],
  ])

  server.job = 'completed'
  await sync()
  assert.deepEqual(agent.profile.history.outbox, [])
  assert.deepEqual(agent.state().messages.map(row => [row.id, row.status]), [
    [id, undefined], ['evt_other_device', undefined],
  ])
})
