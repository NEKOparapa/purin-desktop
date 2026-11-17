const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { framePath } = require('./materials.cjs')

const firstDelay = 10_000
const interval = 60_000
const maxQueueBytes = 128 * 1024 * 1024

function newTitleRun(title, target, at) {
  return { title, handle: target.id, pid: target.pid, start: at, samples: [] }
}

function sameTitle(run, title, target) {
  if (!run || !target || run.title !== title) return false
  // Titles are tracked within a single app visit. Only untitled windows need
  // the native identity to avoid pooling unrelated work.
  return Boolean(title) || (run.handle === target.id && run.pid === target.pid)
}

function nextFrameAt(run) {
  const last = run.samples.at(-1)
  return last ? Date.parse(last.occurred_at) + interval : Date.parse(run.start) + firstDelay
}

function middleIndex(samples, start, end) {
  const midpoint = (Date.parse(start) + Date.parse(end)) / 2
  const distance = i => Math.abs(Date.parse(samples[i].occurred_at) - midpoint)
  let best = 1
  for (let i = 2; i < samples.length - 1; i++) {
    if (distance(i) < distance(best)) best = i
  }
  return best
}

function saveSample(profile, span, jpegBase64, at) {
  const run = span.titleRun
  const bytes = Buffer.byteLength(jpegBase64, 'base64')
  let used = 0
  for (const frames of [span.frames, run.samples, ...profile.history.materials.map(i => i.frames)]) {
    for (const frame of frames || []) used += frame.bytes
  }
  if (used + bytes > maxQueueBytes) throw new Error('截图队列已达 128 MiB，无法保存当前采样')
  const data = Buffer.from(jpegBase64, 'base64')
  if (data.length > 4 * 1024 * 1024 || data[0] !== 0xff || data[1] !== 0xd8)
    throw new Error('截图格式或大小无效')
  const id = randomUUID()
  const file = framePath(profile, id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data, { flag: 'wx', mode: 0o600 })
  const sha256 = createHash('sha256').update(data).digest('hex')
  run.samples.push({ id, occurred_at: at, bytes, sha256, segment: run.start,
    ...(run.title && { window_title: run.title }) })
  // The midpoint only moves forward. Earlier interior samples can no longer win,
  // even if this title stays on screen for the rest of the day.
  if (run.samples.length <= 3) return []
  return run.samples.splice(1, middleIndex(run.samples, run.start, at) - 1)
}

// Keep the exact midpoint by selecting after the end of the title is known.
function finishTitle(span, end) {
  const run = span?.titleRun
  if (!run) return []
  delete span.titleRun
  const samples = run.samples
  if (!samples.length) return []
  let kept = samples
  if (samples.length > 3) {
    const middle = samples[middleIndex(samples, run.start, end)]
    kept = [samples[0], middle, samples.at(-1)]
  }
  span.frames = [...(span.frames ?? []), ...kept]
  return samples.filter(frame => !kept.includes(frame))
}

function discardSamples(profile, frames) {
  for (const frame of frames) fs.rmSync(framePath(profile, frame.id), { force: true })
}

module.exports = { newTitleRun, sameTitle, nextFrameAt, saveSample, finishTitle, discardSamples }
