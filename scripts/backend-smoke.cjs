// Run against an isolated backend fixture configured through WINTERMUTE_TEST_URL.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { DesktopAgent } = require('../electron/agent.cjs')
const { ChatHistory } = require('../electron/chat-history.cjs')
const notifications = require('../electron/notifications.cjs')
const { submitMaterial, framePath } = require('../electron/materials.cjs')
const { advanceWindowSpan } = require('../electron/window-spans.cjs')

async function main() {
  const url = process.env.WINTERMUTE_TEST_URL
  assert.ok(url, 'Set WINTERMUTE_TEST_URL to an isolated backend fixture')
  const profile = {
    url, deviceId: 'desktop-test', token: 'test-token-desktop-test',
    controller: new AbortController(),
  }
  const agent = Object.create(DesktopAgent.prototype)
  agent.profile = profile
  async function api(route, body, expected = 200) {
    const response = await fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Device-ID': profile.deviceId,
        Authorization: `Bearer ${profile.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    const data = await response.json()
    assert.equal(response.status, expected, JSON.stringify(data))
    return data
  }

  const schedule = await agent.schedule({
    start: new Date(Date.now() - 86400000).toISOString(),
    end: new Date(Date.now() + 3 * 86400000).toISOString(),
  })
  assert.ok(schedule.items.some(item => item.title === 'contract schedule'))

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wintermute-contract-'))
  profile.mediaDirectory = directory
  try {
    fs.mkdirSync(path.join(directory, 'periodic'))
    const start = Date.now() - 60000
    const sample = { activity: 'active', foreground_app: 'Editor', window_title: 'contract.txt' }
    const first = advanceWindowSpan(null, sample, new Date(start))
    const middle = advanceWindowSpan(first.active, sample, new Date(start + 30000))
    const { finished } = advanceWindowSpan(middle.active, { activity: 'locked' }, new Date(start + 60000))
    const frames = Array.from({ length: 5 }, (_, index) => ({
      id: randomUUID(), occurred_at: new Date(start + 5000 * (index + 1)).toISOString(),
      window_title: 'contract.txt', segment: 0,
    }))
    for (const frame of frames)
      fs.writeFileSync(framePath(profile, frame.id), Buffer.from(process.env.WINTERMUTE_TEST_JPEG, 'base64'))
    const material = { kind: 'perception', body: finished, frames }
    const send = (_profile, route, body) => api(route, body, 202)
    const uploaded = await submitMaterial(profile, material, send, profile.controller.signal)
    assert.equal(typeof uploaded.event_id, 'string')
    const retried = await submitMaterial(profile, material, send, profile.controller.signal)
    assert.equal(retried.event_id, uploaded.event_id)
    assert.equal(retried.duplicate, true)
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()))
    fs.rmSync(directory, { recursive: true, force: true })
  }

  const body = { message_id: 'desktop-smoke-message', text: 'desktop hello' }
  const receipt = await api('/v1/messages', body, 202)
  const duplicate = await api('/v1/messages', body, 202)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.job_id, receipt.job_id)
  let job
  for (let attempt = 0; attempt < 100; attempt++) {
    job = await api(`/v1/jobs/${receipt.job_id}`)
    if (job.status === 'completed') break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(job.status, 'completed')
  assert.equal(job.outputs[0].text, 'smoke reply')
  const output = job.outputs[0]
  const inbox = await api('/v1/outputs?limit=100')
  assert.ok(inbox.outputs.some(item => item.output_id === output.output_id))
  assert.equal((await api(`/v1/outputs/${output.output_id}/ack`, {})).status, 'delivered')
  const chat = new ChatHistory()
  await chat.read(api)
  assert.ok(chat.messages.some(row => row.text === 'desktop hello'))
  assert.ok(chat.messages.some(row => row.text === 'smoke reply'))

  const page = notifications.validatePage(await api(notifications.pageRoute()))
  const notice = page.items.find(item => item.title === 'smoke-desktop-test')
  assert.ok(notice)
  await api(notifications.notificationPath(notice.id) + '/received', {})
  await api(notifications.notificationPath(notice.id) + '/read', {})
  const questions = await api('/v1/questions?status=pending&limit=20')
  const question = questions.items.find(item => item.title === 'smoke-desktop-test')
  assert.ok(question)
  const answer = await api(`/v1/questions/${question.id}/answer`, {
    selected_options: ['继续'], answer_text: '',
  })
  assert.equal(answer.status, 'answered')
  const { call } = await api('/v1/terminal-tools/claim', { tools: ['device_status'] })
  assert.equal(call.tool, 'device_status')
  assert.equal((await api(`/v1/terminal-tools/${call.id}/result`, {
    claim_token: call.claim_token, status: 'succeeded', stdout: '{}', stderr: '',
    exit_code: 0, truncated: false,
  })).status, 'succeeded')
  const connector = await api('/v1/connectors/device-sync', {
    id: 'terminal', name: '本机命令行', enabled: false, config: {},
  })
  const connectors = await api('/v1/connectors')
  assert.ok(connectors.items.some(item => item.id === connector.item.id))
  console.log('Desktop: chat, history, calendar, batched frames/retry, notifications, questions, tools OK')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
