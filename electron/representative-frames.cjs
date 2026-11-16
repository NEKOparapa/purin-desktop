const fs = require('node:fs')
const path = require('node:path')
const { prepareShare, framePath } = require('./materials.cjs')

const width = 64
const height = 48
const maxFrames = 4
const maxQueueBytes = 128 * 1024 * 1024

// Electron's bitmap is BGRA on supported desktop platforms.
function visualSignature(image) {
  const bitmap = image.resize({ width, height, quality: 'good' }).toBitmap()
  if (bitmap.length !== width * height * 4) throw new Error('无法读取前台截图缩略图')
  const result = Buffer.alloc(width * height)
  for (let i = 0; i < result.length; i++) {
    const j = i * 4
    result[i] = (bitmap[j] * 29 + bitmap[j + 1] * 150 + bitmap[j + 2] * 77) >> 8
  }
  return result
}

function changed(before, after) {
  // Exclude title bars, task bars and window edges. A cursor blink or badge
  // changes very few thumbnail pixels compared with a line of body text.
  let count = 0
  for (let y = 3; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x
      if (Math.abs(before[i] - after[i]) >= 12 && ++count >= 10) return true
    }
  }
  return false
}

function credits(profile, now) {
  const previous = profile.history.frameBudget
  if (!previous) return maxFrames
  const elapsed = Math.max(0, now - previous.at)
  return Math.min(maxFrames, previous.credits + elapsed / (profile.screenshotMinutes * 60000))
}

function canSample(profile, span) {
  return credits(profile, Date.now()) >= 1 || span.frames?.length >= 2
}

// Save the index before deleting a replaced file; the startup sweep removes
// orphaned files if the app exits between the two operations.
function retain(profile, span, sample, saveHistory) {
  const frames = span.frames ?? []
  const now = Date.now()
  const available = credits(profile, now)
  const append = frames.length < maxFrames && available >= 1
  if (!append && frames.length < 2) return false
  const last = append ? null : frames.at(-1)
  const bytes = Buffer.byteLength(sample.jpegBase64, 'base64')
  const queued = profile.history.materials.reduce((total, item) =>
    total + (item.frames ?? []).reduce((sum, f) => sum + f.bytes, 0), 0)
  const active = frames.reduce((sum, frame) => sum + frame.bytes, 0)
  if (queued + active + bytes - (last?.bytes || 0) > maxQueueBytes)
    throw new Error('代表帧队列已达 128 MiB，上传后继续采集')
  const { id } = prepareShare({ kind: 'image', occurredAt: sample.at,
    jpegBase64: sample.jpegBase64 }, path.join(profile.mediaDirectory, 'periodic'))
  const frame = { id, occurred_at: sample.at, bytes }
  if (sample.title) frame.window_title = sample.title
  span.frames = append ? [...frames, frame] : [...frames.slice(0, -1), frame]
  if (append) profile.history.frameBudget = { at: now, credits: available - 1 }
  saveHistory()
  if (last) fs.rmSync(framePath(profile, last.id), { force: true })
  return true
}

// One transient candidate in memory. A changing video/animation should not
// keep emitting frames. A single new settled state can still be useful at exit.
function observeFrame(profile, span, sample, saveHistory) {
  if (sample.signature.length !== width * height) throw new Error('截图特征无效')
  let probe = profile.frameProbe
  if (probe?.id !== span.id) {
    probe = { id: span.id, reference: null, pending: null, moving: false }
    profile.frameProbe = probe
  }
  // The collector supplies a confirmed work-object title. Documents with
  // the same layout can differ by just a few letters at thumbnail scale.
  if (!probe.reference || (sample.title && sample.title !== probe.referenceTitle)) {
    if (retain(profile, span, sample, saveHistory)) {
      probe.reference = sample.signature
      probe.referenceTitle = sample.title
    }
    probe.pending = null
    probe.moving = false
    return
  }
  if (!changed(probe.reference, sample.signature)) {
    probe.pending = null
    probe.moving = false
    return
  }
  if (probe.pending && probe.pending.title === sample.title &&
      !changed(probe.pending.signature, sample.signature)) {
    if (retain(profile, span, sample, saveHistory)) probe.reference = sample.signature
    probe.pending = null
    probe.moving = false
    return
  }
  probe.moving = !!probe.pending && probe.pending.title === sample.title
  probe.pending = sample
}

function finishFrames(profile, span, end, saveHistory) {
  const probe = profile.frameProbe
  profile.frameProbe = null
  if (probe?.id === span.id && probe.pending && !probe.moving &&
      Date.parse(probe.pending.at) <= Date.parse(end)) {
    try { retain(profile, span, probe.pending, saveHistory) }
    catch (error) { profile.screenshotIssue = error.message }
  }
  return span.frames ?? []
}

module.exports = { visualSignature, canSample, observeFrame, finishFrames }
