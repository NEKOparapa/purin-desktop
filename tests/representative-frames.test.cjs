const { test } = require('node:test')
const assert = require('node:assert/strict')
const { newTitleRun, sameTitle, nextFrameAt, finishTitle } = require('../electron/representative-frames.cjs')

const start = Date.UTC(2026, 10, 17, 1)
const at = seconds => new Date(start + seconds * 1000).toISOString()
const run = () => newTitleRun('周会议程', { id: '34', pid: 121 }, at(0))
const frame = time => ({ id: String(time), occurred_at: at(time) })

test('the same title in one app keeps its timer; untitled windows are distinguished by handle', () => {
  const other = { id: '42', pid: 121 }
  assert.equal(sameTitle(run(), '周会议程', other), true)
  assert.equal(sameTitle(run(), '风险清单', other), false)
  assert.equal(sameTitle(newTitleRun('', { id: '34', pid: 121 }, at(0)), '', other), false)
})

test('first deadline is ten seconds and the next deadline is a minute after the last sample', () => {
  const title = run()
  assert.equal(nextFrameAt(title), Date.parse(at(10)))
  title.samples.push(frame(11))
  assert.equal(nextFrameAt(title), Date.parse(at(71)))
})

test('keeps start, nearest to elapsed-time midpoint and last, including irregular captures', () => {
  const span = { titleRun: run() }
  span.titleRun.samples = [10, 70, 132, 310, 370, 490].map(frame)
  const removed = finishTitle(span, at(525))
  assert.deepEqual(span.frames.map(f => f.id), ['10', '310', '490'])
  assert.deepEqual(removed.map(f => f.id), ['70', '132', '370'])
  assert.equal(span.titleRun, undefined)
})

test('short title segments keep zero to three frames without duplicating the middle', () => {
  for (const times of [[], [10], [10, 70], [10, 70, 130]]) {
    const span = { frames: [frame(-60)], titleRun: run() }
    span.titleRun.samples = times.map(frame)
    assert.deepEqual(finishTitle(span, at(180)), [])
    assert.deepEqual(span.frames, [-60, ...times].map(frame))
  }
})
