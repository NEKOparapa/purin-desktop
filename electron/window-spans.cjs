const { randomUUID } = require('node:crypto')

// After a sampling interruption we only know the visit up to its last observation.
const maxSampleGap = 45_000
const maxInputSegments = 50

function normalizeInputSegment(segment, spanStartMs, spanEndMs, lastEndMs) {
  if (!segment || typeof segment.text !== 'string' || !segment.text.trim()) return null
  let startMs = Date.parse(segment.occurred_at)
  if (!Number.isFinite(startMs)) startMs = spanEndMs
  startMs = Math.max(startMs, spanStartMs, lastEndMs)
  if (startMs > spanEndMs) startMs = spanEndMs
  let endMs = segment.ended_at ? Date.parse(segment.ended_at) : startMs
  if (!Number.isFinite(endMs) || endMs < startMs) endMs = startMs
  if (endMs > spanEndMs) endMs = spanEndMs
  const occurredAt = new Date(startMs).toISOString()
  const endedAt = new Date(endMs).toISOString()
  return {
    occurred_at: occurredAt,
    ...(endMs > startMs && { ended_at: endedAt }),
    text: segment.text.trim(),
    ...(segment.window_title && { window_title: segment.window_title }),
  }
}

function appendInputSegments(span, segments, boundEnd) {
  if (!span || !Array.isArray(segments) || !segments.length) return false
  const spanStartMs = Date.parse(span.start)
  const spanEndMs = Date.parse(boundEnd || span.awaySince || span.lastSeen || span.start)
  if (!Number.isFinite(spanStartMs) || !Number.isFinite(spanEndMs) || spanEndMs < spanStartMs) {
    return false
  }
  span.inputSegments ??= []
  let added = false
  for (const raw of segments) {
    const prev = span.inputSegments.at(-1)
    const lastEndMs = prev ? Date.parse(prev.ended_at || prev.occurred_at) : spanStartMs
    const normalized = normalizeInputSegment(raw, spanStartMs, spanEndMs, lastEndMs)
    if (!normalized) continue
    if (span.inputSegments.length >= maxInputSegments) {
      span.inputSegments.splice(1, 1)
      span.omittedInputSegments = (span.omittedInputSegments || 0) + 1
    }
    span.inputSegments.push(normalized)
    added = true
  }
  return added
}

function clampInputSegments(segments, startIso, endIso) {
  if (!Array.isArray(segments) || !segments.length) return []
  const spanStartMs = Date.parse(startIso)
  const spanEndMs = Date.parse(endIso)
  if (!Number.isFinite(spanStartMs) || !Number.isFinite(spanEndMs) || spanEndMs < spanStartMs) {
    return []
  }
  const result = []
  let lastEndMs = spanStartMs
  for (const raw of segments) {
    const normalized = normalizeInputSegment(raw, spanStartMs, spanEndMs, lastEndMs)
    if (!normalized) continue
    lastEndMs = Date.parse(normalized.ended_at || normalized.occurred_at)
    result.push(normalized)
  }
  return result
}

function finishSpan(span, observedEnd) {
  if (!span) return null
  // An interrupted visit saved by an older client can include time spent away.
  const end = span.awaySince || observedEnd
  const elapsed = Date.parse(end) - Date.parse(span.start) - (span.awayMs || 0)
  const inputSegments = clampInputSegments(span.inputSegments, span.start, end)
  return {
    event_id: span.id,
    occurred_at: end,
    state_key: 'desktop.window_span',
    value: {
      foreground_app: span.app,
      ...(span.title && { window_title: span.title }),
      started_at: span.start,
      ended_at: end,
      duration_seconds: Math.max(0, elapsed) / 1000,
      ...(span.workObjects?.length && { work_objects: span.workObjects }),
      ...(span.omittedObjects && { work_objects_omitted: span.omittedObjects }),
      ...(inputSegments.length && { input_segments: inputSegments }),
      ...(inputSegments.length > 1 &&
        span.omittedInputSegments && { input_segments_omitted: span.omittedInputSegments }),
    },
  }
}

function advanceWindowSpan(previous, sample, at = new Date(), { onBeforeFinish } = {}) {
  const observed = at.toISOString()
  const app = sample?.activity === 'active' && sample.foreground_app
  const gap = previous ? at.getTime() - Date.parse(previous.lastSeen) : 0
  const interrupted = gap < 0 || gap > maxSampleGap
  let active = previous
  let finished = null
  if (previous && (interrupted || previous.app !== app)) {
    const finishEnd = interrupted ? previous.lastSeen : observed
    if (typeof onBeforeFinish === 'function') onBeforeFinish(previous, finishEnd)
    finished = finishSpan(previous, finishEnd)
    active = null
  }
  if (app) {
    active ??= { id: randomUUID(), app, start: observed, workObjects: [] }
    const title = sample.window_title || ''
    if (title !== (active.title || '')) {
      if (title) {
        active.workObjects.push({ occurred_at: observed, window_title: title })
      } else {
        // A title can become unreadable while the application remains in focus.
        const last = active.workObjects.at(-1)
        if (last) last.ended_at = observed
      }
      active.title = title
    }
    active.lastSeen = observed
  }
  return { active, finished }
}

module.exports = { advanceWindowSpan, appendInputSegments, maxInputSegments }
