const { test } = require('node:test')
const assert = require('node:assert/strict')
const { advanceWindowSpan } = require('../electron/window-spans.cjs')

const meeting = {
  activity: 'active',
  foreground_app: 'Code',
  window_title: '会议纪要',
}
const notes = { ...meeting, window_title: '另一个文档' }
const chat = { activity: 'active', foreground_app: 'Chat' }
const browser = { activity: 'active', foreground_app: 'Chrome' }
const base = Date.UTC(2026, 10, 14, 2)
const at = (ms) => new Date(base + ms)

function recording() {
  let active = null
  return (ms, sample) => {
    const step = advanceWindowSpan(active, sample, at(ms))
    active = step.active
    return step
  }
}

test('every observed departure finishes a separate visit, including immediate returns', () => {
  const step = recording()
  const first = step(0, meeting).active.id
  assert.equal(step(5000, meeting).finished, null)
  const left = step(8000, chat)
  assert.equal(left.finished.event_id, first)
  assert.equal(left.finished.value.duration_seconds, 8)
  const returned = step(10_000, meeting)
  assert.equal(returned.finished.event_id, left.active.id)
  assert.equal(returned.finished.value.duration_seconds, 2)
  assert.equal(returned.finished.value.started_at, at(8000).toISOString())
  assert.equal(returned.finished.occurred_at, at(10_000).toISOString())
  assert.notEqual(returned.active.id, first)
})

test('raw duration preserves milliseconds on both sides of five seconds', () => {
  for (const ms of [0, 2999, 3000, 3001, 4999, 5000, 5001]) {
    const step = recording()
    step(0, meeting)
    assert.equal(step(ms, chat).finished.value.duration_seconds, ms / 1000)
  }
})

test('all observed title runs remain ordered, even short, repeated and badge titles', () => {
  const step = recording()
  const titles = ['会议纪要', '● 会议纪要', '会议纪要', '(2) 通知',
    ...Array.from({length: 19}, (_, i) => '文档 ' + i)]
  titles.forEach((title, i) => {
    assert.equal(step(i * 1000, {...meeting, window_title: title}).finished, null)
    step(i * 1000 + 100, {...meeting, window_title: title})
  })
  const { value } = step(23_500, chat).finished
  assert.deepEqual(value.work_objects, titles.map((window_title, i) =>
    ({window_title, occurred_at: at(i * 1000).toISOString()})))
  assert.equal(value.window_title, titles.at(-1))
})

test('losing access to a title closes it without assigning the unknown time to it', () => {
  const step = recording()
  step(0, browser)
  step(5000, {...browser, window_title: '首页'})
  step(6500, browser)
  step(12000, {...browser, window_title: '首页'})
  const end = step(16000, chat).finished
  assert.deepEqual(end.value.work_objects, [
    {window_title: '首页', occurred_at: at(5000).toISOString(), ended_at: at(6500).toISOString()},
    {window_title: '首页', occurred_at: at(12000).toISOString()},
  ])
})

test('inactive observations close once; a clock jump closes at the last sample', () => {
  for (const stop of [null, {activity: 'locked'}, {activity: 'idle'}, {activity: 'active'}]) {
    const step = recording()
    step(0, notes)
    assert.equal(step(1800, stop).finished.value.duration_seconds, 1.8)
    assert.equal(step(1900, stop).finished, null)
  }
  for (const jump of [4000, 60_000]) {
    const step = recording()
    step(0, meeting)
    step(5000, meeting)
    const {finished, active} = step(jump, meeting)
    assert.equal(finished.value.duration_seconds, 5)
    assert.notEqual(finished.event_id, active.id)
  }
})

test('recovery honors the last known departure of an older active visit', () => {
  const old = {id:'old', app:'Code', start:at(0).toISOString(), lastSeen:at(15_000).toISOString(),
    awaySince:at(17_000).toISOString(), awayMs:1000}
  const {finished} = advanceWindowSpan(old, null, at(3600_000))
  assert.equal(finished.occurred_at, old.awaySince)
  assert.equal(finished.value.duration_seconds, 16)
})
