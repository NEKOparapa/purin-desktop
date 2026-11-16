const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { canSample, observeFrame, finishFrames } = require('../electron/representative-frames.cjs')

function scene(value) {
  const image = Buffer.alloc(64 * 48, 100)
  // A small changed line in the document body.
  image.fill(value, 64 * 20 + 15, 64 * 20 + 36)
  return image
}

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 17, 1) })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-frame-select-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const profile = { mediaDirectory: dir, screenshotMinutes: 15, history: { materials: [] } }
  const span = { id: 'a' }
  const junction = path.join(dir, 'periodic')
  function frame(signature, title = '会议文档') {
    t.mock.timers.tick(15000)
    const at = new Date().toISOString()
    observeFrame(profile, span, { signature, at, title,
      jpegBase64: Buffer.from([0xff,0xd8, signature[64 * 20 + 15], 0xff,0xd9]).toString('base64') }, () => {})
    return at
  }
  return { profile, span, frame, junction }
}

test('keeps the first frame and settled edits, ignoring chrome and animation', t => {
  const { profile, span, frame } = fixture(t)
  const start = frame(scene(100))
  const badge = scene(100)
  badge.fill(200, 4, 40)
  badge[300] = 0
  frame(badge)
  assert.equal(span.frames.length, 1)
  frame(scene(20))
  const edit = frame(scene(21))
  assert.equal(span.frames.length, 2)
  frame(scene(210))
  frame(scene(160))
  frame(scene(190))
  const frames = finishFrames(profile, span, new Date().toISOString(), () => {})
  assert.deepEqual(frames.map(f => f.occurred_at), [start, edit])
})

test('keeps a newly confirmed work object even when its template looks identical', t => {
  const { span, frame } = fixture(t)
  frame(scene(100), '上周议程')
  frame(scene(100), '本周议程')
  frame(scene(100), '本周议程')
  assert.deepEqual(span.frames.map(f => f.window_title), ['上周议程', '本周议程'])
})

test('spends a shared budget, preserves the start and replaces the last saved file at exit', t => {
  const { profile, span, frame, junction } = fixture(t)
  const start = frame(scene(30))
  for (const v of [80, 150, 220]) {
    frame(scene(v))
    frame(scene(v))
  }
  assert.equal(span.frames.length, 4)
  const oldLast = span.frames.at(-1).id
  const final = frame(scene(40))
  const frames = finishFrames(profile, span, final, () => {})
  assert.equal(frames.at(0).occurred_at, start)
  assert.equal(frames.at(-1).occurred_at, final)
  assert.equal(frames.length, 4)
  assert.equal(fs.existsSync(path.join(junction, oldLast)), false)
  assert.deepEqual(fs.readdirSync(junction).sort(), frames.map(f => f.id).sort())
  assert.equal(canSample(profile, { id: 'b' }), false)
  t.mock.timers.tick(15 * 60 * 1000)
  assert.equal(canSample(profile, { id: 'b' }), true)
})
