const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { setTimeout: delay } = require('node:timers/promises')
const { DesktopAgent } = require('../electron/agent.cjs')

async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await delay(10)
  }
  assert.fail('Desktop worker did not reach expected state')
}

test('uncertain submission, stale jobs, delivered recovery, and durable capture retries', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 14, 1) })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wintermute-agent-test-'))
  const events = [],
    slices = [],
    submissions = []
  let observation = { activity: 'idle' }
  let ackAttempts = 0,
    jobQueries = 0,
    gatherCalls = 0
  let inbox = []
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = raw && JSON.parse(raw)
    const url = req.url
    function json(status, data) {
      res.writeHead(status)
      res.end(JSON.stringify(data))
    }
    if (url.startsWith('/v1/outputs?')) return json(200, { outputs: inbox })
    if (url === '/v1/slices') {
      slices.push(body)
      return json(202, { event_id: body.event_id })
    }
    if (url === '/v1/perceptions') {
      events.push(body)
      return events.length === 1
        ? json(503, {})
        : json(202, { event_id: body.event_id })
    }
    if (url === '/v1/messages') {
      submissions.push(body)
      if (submissions.length === 1) return json(502, {})
      return json(202, { job_id: body.text === '会议' ? 'gone' : 'second' })
    }
    if (url === '/v1/jobs/gone') return json(404, {})
    if (url === '/v1/jobs/second') {
      jobQueries++
      return json(200, {
        status: 'completed',
        outputs: [
          {
            output_id: 'old',
            layer: 'conversation',
            text: '周五',
            status: 'delivered',
          },
        ],
      })
    }
    if (url === '/v1/outputs/note/ack') {
      const ledger = JSON.parse(
        fs.readFileSync(
          path.join(
            dir,
            fs.readdirSync(dir).find((name) => name.startsWith('terminal-')),
          ),
        ),
      )
      assert.equal(ledger.messages.filter((m) => m.id === 'note').length, 1)
      if (++ackAttempts === 1) return json(503, {})
      inbox = []
      return json(200, {})
    }
    return json(404, {})
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const secure = {
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString(),
  }
  function launch() {
    const agent = new DesktopAgent(
      dir,
      secure,
      async () => {
        gatherCalls++
        return observation
      },
      () => {},
    )
    clearInterval(agent.pollTimer)
    clearInterval(agent.captureTimer)
    return agent
  }
  let client = launch()
  t.after(async () => {
    client.close()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  })
  await client.configure({
    url: 'http://127.0.0.1:' + server.address().port,
    terminal: 'http-desktop',
    token: 'fixture',
  })
  await until(() => !client.profile.syncing)
  assert.equal(gatherCalls, 0)
  client.send('会议')
  await until(() => !client.profile.syncing)
  assert.equal(client.state().messages[0].status, 'unsent')
  client.retry(client.state().messages[0].id)
  client.send('补充')
  await until(() => !client.profile.syncing)
  await client.sync()
  assert.equal(submissions[0].message_id, submissions[1].message_id)
  assert.equal(client.state().messages[0].status, 'missing')
  assert.equal(jobQueries, 1)
  assert.equal(client.state().messages.find((m) => m.id === 'old').text, '周五')

  inbox = [
    {
      output_id: 'note',
      layer: 'notification',
      text: '会议已确认',
      status: 'pending',
    },
  ]
  await client.sync()
  assert.equal(ackAttempts, 1)
  client.setCollection(true)
  await until(() => !client.profile.capturing)
  assert.equal(events.length, 0)
  client.close()
  client = launch()
  await until(() => !client.profile.capturing && !client.profile.syncing)
  assert.equal(ackAttempts, 2)
  assert.equal(client.state().messages.filter((m) => m.id === 'note').length, 1)
  assert.equal(events.length, 0)
  observation = {
    activity: 'active',
    foreground_app: 'Code',
    window_title: 'meeting.md',
  }
  const firstSeen = new Date().toISOString()
  await client.capture()
  assert.equal(events.length, 0)
  t.mock.timers.tick(4999)
  await client.capture()
  assert.equal(events.length, 0)
  t.mock.timers.tick(1)
  await client.capture()
  await client.flushMaterials()
  assert.equal(events.length, 0)
  observation = { ...observation, window_title: 'notes.md' }
  await client.capture()
  await client.flushMaterials()
  assert.equal(events.length, 0)
  t.mock.timers.tick(10000)
  observation = { activity: 'idle' }
  await client.capture()
  await client.flushMaterials()
  assert.equal(slices.length, 0)
  const [span] = events
  assert.equal(span.state_key, 'desktop.window_span')
  assert.deepEqual(span.value, {
    foreground_app: 'Code',
    window_title: 'notes.md',
    started_at: firstSeen,
    ended_at: new Date().toISOString(),
    duration_seconds: 15,
  })
  assert.equal(events.length, 1)
  assert.equal(client.state().lastSpan, null)
  client.close()
  t.mock.timers.tick(10000)
  client = launch()
  await until(() => events.length === 2 && !client.profile.flushing)
  assert.deepEqual(events[0], events[1])
  assert.deepEqual(client.state().lastSpan, span.value)
  client.setCollection(false)
  const callsBeforeStop = gatherCalls
  observation = {
    activity: 'active',
    foreground_app: 'Code',
    window_title: 'private.md',
  }
  await client.capture()
  await client.flushMaterials()
  assert.equal(gatherCalls, callsBeforeStop)
  assert.equal(slices.length, 0)
  assert.equal(events.length, 2)
})
