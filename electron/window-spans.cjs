const { randomUUID } = require('node:crypto')

// After a sampling interruption we only know the visit up to its last observation.
const maxSampleGap = 45_000

function finishSpan(span, observedEnd) {
  if (!span) return null
  // An interrupted visit saved by an older client can include time spent away.
  const end = span.awaySince || observedEnd
  const elapsed = Date.parse(end) - Date.parse(span.start) - (span.awayMs || 0)
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
    },
  }
}

function advanceWindowSpan(previous, sample, at = new Date()) {
  const observed = at.toISOString()
  const app = sample?.activity === 'active' && sample.foreground_app
  const gap = previous ? at.getTime() - Date.parse(previous.lastSeen) : 0
  const interrupted = gap < 0 || gap > maxSampleGap
  let active = previous
  let finished = null
  if (previous && (interrupted || previous.app !== app)) {
    finished = finishSpan(previous, interrupted ? previous.lastSeen : observed)
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

module.exports = { advanceWindowSpan }
