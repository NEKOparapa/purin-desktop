const { randomUUID } = require('node:crypto')

// A longer gap can be caused by sleep or a stopped client.
const maxSampleGap = 45_000
const minDwellMs = 5_000
const maxWorkObjects = 16
const stateKey = 'desktop.window_span'

function spanValue(app, title, start, end, seconds) {
  return {
    foreground_app: app,
    ...(title ? { window_title: title } : {}),
    started_at: start,
    ended_at: end,
    duration_seconds: seconds,
  }
}

// v2 persisted completed spans only as this sentence. Retain the producer ID
// both for offline retries and for screenshots already referencing the span.
function migrateWindowSlice(item) {
  if (typeof item.body?.text !== 'string') return item
  const { text, ...capture } = item.body
  const match =
    /^桌面前台停留（采样估算）：(\S+) 至 (\S+)，约 (\d+) 秒。应用「(.*?)」(?:，窗口标题「(.*)」)?。$/su.exec(
      text,
    )
  if (
    !match ||
    capture.event_id !== item.id ||
    capture.occurred_at !== match[2]
  )
    return item
  const duration = Math.round(
    (Date.parse(match[2]) - Date.parse(match[1])) / 1000,
  )
  if (
    !match[4] ||
    !Number.isSafeInteger(duration) ||
    duration <= 0 ||
    duration !== Number(match[3])
  )
    return item
  const value = spanValue(match[4], match[5], match[1], match[2], duration)
  return {
    ...item,
    kind: 'perception',
    body: { ...capture, state_key: stateKey, value },
    legacyWindowText: text,
    rejected: false,
    attempts: 0,
    retryAt: 0,
    error: '',
  }
}

function finishSpan(span, observedEnd) {
  if (!span) return null
  const end = span.awaySince || observedEnd
  const elapsed = Date.parse(end) - Date.parse(span.start) - (span.awayMs || 0)
  if (elapsed < minDwellMs) return null
  return {
    event_id: span.id,
    occurred_at: end,
    state_key: stateKey,
    value: {
      ...spanValue(
        span.app,
        span.workObjects?.at(-1)?.window_title || span.title,
        span.start,
        end,
        Math.round(elapsed / 1000),
      ),
      ...(span.workObjects?.length > 1 && { work_objects: span.workObjects }),
      ...(span.omittedObjects && { work_objects_omitted: span.omittedObjects }),
    },
  }
}

// A title can change for a notification badge or the editor's dirty indicator.
// Only distinct objects observed twice past the dwell threshold enter the visit.
function observeObject(span, title, observed) {
  const clean = title
    .replace(/^(?:\(\d{1,3}\+?\)|\[\d{1,3}\+?\])\s+/u, '')
    .replace(/^[●*]\s+|\s+[●*]$/gu, '')
    .trim()
  if (!clean || clean === span.workObjects?.at(-1)?.window_title) {
    delete span.pendingObject
    return span
  }
  if (span.pendingObject?.window_title !== clean) {
    span.pendingObject = { occurred_at: observed, window_title: clean }
  } else if (
    Date.parse(observed) - Date.parse(span.pendingObject.occurred_at) >=
    minDwellMs
  ) {
    const objects = [...(span.workObjects || []), span.pendingObject]
    if (objects.length > maxWorkObjects) {
      objects.splice(1, 1)
      span.omittedObjects = (span.omittedObjects || 0) + 1
    }
    span.workObjects = objects
    delete span.pendingObject
  }
  return span
}

function advanceWindowSpan(previous, candidate, sample, at = new Date()) {
  const observed = at.toISOString()
  const app = sample?.activity === 'active' && sample.foreground_app
  const title = sample?.window_title || ''
  const lastSample =
    candidate?.lastSeen || previous?.awaySince || previous?.lastSeen
  const gap = lastSample ? at.getTime() - Date.parse(lastSample) : 0
  const interrupted = gap < 0 || gap > maxSampleGap
  if (interrupted || !app) {
    return {
      active: null,
      candidate: app
        ? observeObject(
            { app, title, start: observed, lastSeen: observed },
            title,
            observed,
          )
        : null,
      finished: finishSpan(
        previous,
        interrupted ? previous?.lastSeen : observed,
      ),
    }
  }

  if (previous?.app === app) {
    const active = {
      ...previous,
      title: title || previous.title,
      lastSeen: observed,
    }
    if (active.awaySince) {
      active.awayMs =
        (active.awayMs || 0) + at.getTime() - Date.parse(active.awaySince)
      delete active.awaySince
    }
    return {
      active: observeObject(active, title, observed),
      candidate: null,
      finished: null,
    }
  }

  let active = previous ?? null
  let finished = null
  if (active && !active.awaySince) {
    active = { ...active, awaySince: observed }
    delete active.pendingObject
  } else if (
    active &&
    at.getTime() - Date.parse(active.awaySince) >= minDwellMs
  ) {
    // The former app stayed out of focus even if several other apps flashed by.
    finished = finishSpan(active, active.awaySince)
    active = null
  }
  const next =
    candidate?.app === app
      ? { ...candidate, title: title || candidate.title, lastSeen: observed }
      : { app, title, start: observed, lastSeen: observed }
  observeObject(next, title, observed)
  if (at.getTime() - Date.parse(next.start) < minDwellMs)
    return { active, candidate: next, finished }
  return {
    active: { ...next, id: randomUUID() },
    candidate: null,
    finished,
  }
}

module.exports = { advanceWindowSpan, migrateWindowSlice, minDwellMs }
