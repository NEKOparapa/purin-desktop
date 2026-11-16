const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  advanceWindowSpan,
  minDwellMs,
} = require('../electron/window-spans.cjs')

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
  let state = { active: null, candidate: null }
  return (ms, sample) => {
    state = advanceWindowSpan(state.active, state.candidate, sample, at(ms))
    return state
  }
}

test('one observation never qualifies, and the app must span five full seconds', () => {
  const step = recording()
  assert.equal(step(0, meeting).active, null)
  assert.equal(step(minDwellMs - 1, meeting).active, null)
  assert.equal(step(minDwellMs, chat).finished, null)
  // A different observation at the end of a 15-second sampling interval is
  // not confirmation that the previous window was present for 15 seconds.
  assert.equal(step(20_000, notes).finished, null)
  assert.equal(step(24_999, notes).active, null)
  const span = step(25_000, notes).active
  assert.equal(span.start, at(20_000).toISOString())
  const idle = step(25_000, { activity: 'idle' })
  assert.deepEqual(idle.finished, {
    event_id: span.id,
    occurred_at: at(25_000).toISOString(),
    state_key: 'desktop.window_span',
    value: {
      foreground_app: 'Code',
      window_title: '另一个文档',
      started_at: at(20_000).toISOString(),
      ended_at: at(25_000).toISOString(),
      duration_seconds: 5,
    },
  })
  assert.equal(idle.candidate, null)
  assert.equal(idle.active, null)
})

test('title changes stay in one app visit, with a single result on confirmed departure', () => {
  const step = recording()
  const tab = (title) => ({ ...browser, window_title: title })
  assert.equal(step(0, tab('议程')).finished, null)
  assert.equal(step(4000, tab('会议纪要')).candidate.start, at(0).toISOString())
  const confirmed = step(5000, browser)
  assert.equal(confirmed.finished, null)
  assert.equal(confirmed.active.title, '会议纪要')
  const updated = step(20_000, tab('ComfyUI'))
  assert.equal(updated.active.id, confirmed.active.id)
  assert.equal(updated.finished, null)
  assert.equal(step(23_000, browser).active.title, 'ComfyUI')
  assert.equal(step(26_000, meeting).finished, null)
  const next = step(31_000, meeting)
  assert.equal(next.active.app, meeting.foreground_app)
  assert.deepEqual(next.finished.value, {
    foreground_app: 'Chrome',
    window_title: 'ComfyUI',
    started_at: at(0).toISOString(),
    ended_at: at(26_000).toISOString(),
    duration_seconds: 26,
  })
  assert.equal(step(33_000, notes).finished, null)
})

test('returning after short switches preserves the original ID and subtracts time away', () => {
  const step = recording()
  step(0, meeting)
  const first = step(5000, meeting).active
  assert.equal(step(10_000, chat).active.awaySince, at(10_000).toISOString())
  assert.equal(step(12_000, browser).finished, null)
  const returned = step(14_000, meeting)
  assert.equal(returned.active.id, first.id)
  assert.equal(returned.active.awaySince, undefined)
  assert.equal(returned.candidate, null)
  step(20_000, chat)
  assert.equal(step(21_000, meeting).active.id, first.id)
  const switching = step(35_000, browser)
  assert.equal(switching.finished, null)
  const next = step(40_000, browser)
  assert.notEqual(next.active.id, first.id)
  assert.equal(next.active.start, at(35_000).toISOString())
  assert.equal(next.finished.event_id, first.id)
  assert.equal(next.finished.value.duration_seconds, 30)
  assert.equal(next.finished.value.ended_at, at(35_000).toISOString())
})

test('stable work objects are ordered inside one visit; brief titles and badge churn disappear', () => {
  const step = recording()
  const tab = (title) => ({ ...browser, window_title: title })
  step(0, tab('(2) 发布议程'))
  const id = step(5000, tab('发布议程')).active.id
  step(8000, tab('临时弹窗'))
  step(10_000, tab('发布议程'))
  step(12_000, tab('发布看板'))
  step(18_000, tab('发布看板'))
  step(20_000, tab('发布议程'))
  step(25_000, tab('● 发布议程'))
  step(28_000, tab('未确认标题'))
  assert.equal(step(30_000, chat).finished, null)
  const { finished } = step(35_000, chat)
  assert.equal(finished.event_id, id)
  assert.equal(finished.value.duration_seconds, 30)
  assert.equal(finished.value.window_title, '发布议程')
  assert.deepEqual(finished.value.work_objects, [
    { occurred_at: at(0).toISOString(), window_title: '发布议程' },
    { occurred_at: at(12_000).toISOString(), window_title: '发布看板' },
    { occurred_at: at(20_000).toISOString(), window_title: '发布议程' },
  ])
})

test('long visits retain their first and recent objects with an explicit omitted count', () => {
  const step = recording()
  for (let i = 0; i < 20; i++) {
    const doc = { ...browser, window_title: '文档 ' + i }
    step(i * 10_000, doc)
    step(i * 10_000 + minDwellMs, doc)
  }
  const { value } = step(200_000, { activity: 'locked' }).finished
  assert.equal(value.work_objects_omitted, 4)
  assert.deepEqual(
    value.work_objects.map((row) => row.window_title),
    ['文档 0', ...Array.from({ length: 15 }, (_, i) => '文档 ' + (i + 5))],
  )
})

test('idle, lock, unavailable window and shutdown close the last confirmed span immediately', () => {
  for (const stop of [
    { activity: 'idle' },
    { activity: 'locked' },
    { activity: 'active' },
    null,
  ]) {
    const step = recording()
    step(0, meeting)
    step(5000, meeting)
    step(9000, chat)
    const closed = step(12_000, stop)
    assert.equal(closed.finished.value.duration_seconds, 9)
    assert.equal(closed.finished.value.ended_at, at(9000).toISOString())
    assert.equal(closed.active, null)
    assert.equal(closed.candidate, null)
    assert.equal(step(13_000, notes).active, null)
  }
})

test('sleep and clock rollback reset candidates and close confirmed windows at their last observation', () => {
  for (const changedClock of [4999, 50_001]) {
    const step = recording()
    step(0, meeting)
    const original = step(5000, meeting).active
    const after = step(changedClock, meeting)
    assert.equal(after.active, null)
    assert.equal(after.finished.occurred_at, at(5000).toISOString())
    assert.equal(after.finished.value.duration_seconds, 5)
    assert.notEqual(step(changedClock + 5000, meeting).active.id, original.id)
  }
  const step = recording()
  step(0, notes)
  assert.equal(step(50_000, notes).active, null)
  assert.equal(step(54_999, notes).active, null)
})

test('five seconds away finishes the app even when no subsequent app qualifies', () => {
  const step = recording()
  step(0, meeting)
  const first = step(5000, meeting).active
  assert.equal(step(10_000, chat).finished, null)
  assert.equal(step(14_000, browser).finished, null)
  const left = step(15_000, chat)
  assert.equal(left.finished.event_id, first.id)
  assert.equal(left.finished.value.duration_seconds, 10)
  assert.equal(left.finished.occurred_at, at(10_000).toISOString())
  assert.equal(left.active, null)
  assert.equal(step(16_000, browser).finished, null)
  assert.equal(step(18_000, meeting).finished, null)
  assert.notEqual(step(23_000, meeting).active.id, first.id)
})

test('recovery closes previously persisted spans without counting downtime or an unconfirmed switch', () => {
  const old = {
    id: 'original',
    app: 'Code',
    title: '会议纪要',
    start: at(0).toISOString(),
    lastSeen: at(15_000).toISOString(),
  }
  assert.equal(
    advanceWindowSpan(old, null, null, at(15_000)).finished.event_id,
    old.id,
  )
  assert.equal(
    advanceWindowSpan(old, null, null, at(3600_000)).finished.value
      .duration_seconds,
    15,
  )
  const interrupted = {
    ...old,
    awaySince: at(17_000).toISOString(),
    awayMs: 1000,
  }
  const recovered = advanceWindowSpan(interrupted, null, null, at(15_000))
  assert.equal(recovered.finished.value.duration_seconds, 16)
  assert.equal(recovered.finished.occurred_at, at(17_000).toISOString())
  const tooShort = { ...old, lastSeen: at(4999).toISOString() }
  assert.equal(advanceWindowSpan(tooShort, null, null, at(4999)).finished, null)
})
