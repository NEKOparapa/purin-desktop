'use strict'

const {
  MAX_SAMPLE_LENGTH,
  codePointLength,
  protectQueuedText,
  isPasswordHint,
} = require('./text-input-filter.cjs')

const DEFAULT_PAUSE_FLUSH_MS = 5000

function isContinuation(previous, next) {
  if (!previous || !next) return false
  return next.startsWith(previous) || previous.startsWith(next)
}

class TextInputTracker {
  constructor(options = {}) {
    this.pauseFlushMs = options.pauseFlushMs ?? DEFAULT_PAUSE_FLUSH_MS
    this.state = null
  }

  reset() {
    this.state = null
  }

  _commit(atMs, { clearField = false } = {}) {
    const s = this.state
    if (!s || s.overLimit || !s.dirty) return null
    const current = s.currentText
    const committed = s.committedText
    let rawToEmit
    if (committed && current.startsWith(committed)) {
      rawToEmit = current.slice(committed.length).trim()
    } else if (committed && current === committed) {
      rawToEmit = ''
    } else {
      rawToEmit = current
    }
    const startedAt = s.startedAt
    const lastChangedAt = s.lastChangedAt
    const windowTitle = s.windowTitle
    const fieldLength = s.peakFieldLength
    if (clearField) {
      s.baselineText = ''
      s.committedText = ''
      s.currentText = ''
      s.dirty = false
      s.startedAt = null
      s.lastChangedAt = null
      s.maxLenSinceEdit = 0
      s.shrinkingSteps = 0
      s.overLimit = false
      s.peakFieldLength = 0
    } else {
      s.baselineText = current
      s.committedText = current
      s.dirty = false
      s.startedAt = null
      s.lastChangedAt = null
      s.maxLenSinceEdit = 0
      s.shrinkingSteps = 0
    }
    if (!rawToEmit) return null
    const startMs = startedAt ?? lastChangedAt ?? atMs
    const endMs = Math.max(startMs, lastChangedAt ?? atMs)
    return {
      occurred_at: new Date(startMs).toISOString(),
      ...(endMs > startMs && { ended_at: new Date(endMs).toISOString() }),
      text: protectQueuedText(rawToEmit, { hint: s.hint }),
      field_length: fieldLength,
      ...(windowTitle && { window_title: windowTitle }),
    }
  }

  observe(spanId, windowTitle, input, at = new Date()) {
    const nowMs = at instanceof Date ? at.getTime() : Number(at)
    const emitted = []
    const title = typeof windowTitle === 'string' ? windowTitle : ''

    if (!spanId || !input || !input.editable || input.is_password || isPasswordHint(input.hint)) {
      if (this.state && this.state.spanId === spanId) {
        const seg = this._commit(nowMs)
        if (seg) emitted.push(seg)
      }
      this.state = null
      return emitted
    }

    const fieldId = typeof input.field_id === 'string' && input.field_id ? input.field_id : 'default'
    const hint = typeof input.hint === 'string' ? input.hint : ''
    const rawTrimmed =
      typeof input.text === 'string' ? input.text.replace(/\r\n?/g, '\n').trim() : ''
    const length = codePointLength(rawTrimmed)
    const tooLong = Boolean(input.too_long) || length > MAX_SAMPLE_LENGTH

    if (this.state && (this.state.spanId !== spanId || this.state.fieldId !== fieldId)) {
      if (this.state.spanId === spanId) {
        const seg = this._commit(nowMs)
        if (seg) emitted.push(seg)
      }
      this.state = null
    }

    if (this.state && this.state.windowTitle !== title) {
      if (!tooLong && isContinuation(this.state.currentText, rawTrimmed)) {
        this.state.windowTitle = title
      } else {
        const seg = this._commit(nowMs)
        if (seg) emitted.push(seg)
        this.state = null
      }
    }

    if (!this.state) {
      this.state = {
        spanId,
        fieldId,
        windowTitle: title,
        hint,
        baselineText: tooLong ? '' : rawTrimmed,
        committedText: tooLong ? '' : rawTrimmed,
        currentText: tooLong ? '' : rawTrimmed,
        dirty: false,
        startedAt: null,
        lastChangedAt: null,
        overLimit: tooLong,
        peakFieldLength: length,
        maxLenSinceEdit: 0,
        shrinkingSteps: 0,
      }
      return emitted
    }

    const s = this.state
    s.peakFieldLength = Math.max(s.peakFieldLength, length)
    if (hint) s.hint = hint

    if (tooLong) {
      s.overLimit = true
      s.dirty = false
      s.startedAt = null
      s.lastChangedAt = null
      s.currentText = ''
      s.maxLenSinceEdit = 0
      s.shrinkingSteps = 0
      return emitted
    }

    if (s.overLimit) {
      if (!rawTrimmed) {
        s.overLimit = false
        s.peakFieldLength = 0
        s.baselineText = ''
        s.committedText = ''
        s.currentText = ''
        s.dirty = false
        s.startedAt = null
        s.lastChangedAt = null
        s.maxLenSinceEdit = 0
        s.shrinkingSteps = 0
      }
      return emitted
    }

    if (rawTrimmed === s.currentText) {
      if (s.dirty && s.lastChangedAt !== null && nowMs - s.lastChangedAt >= this.pauseFlushMs) {
        const seg = this._commit(nowMs)
        if (seg) emitted.push(seg)
      }
      return emitted
    }

    if (!rawTrimmed && s.currentText) {
      if (s.dirty) {
        const prevLen = codePointLength(s.currentText)
        const cancelled = s.maxLenSinceEdit >= 2 && prevLen === 1 && s.shrinkingSteps >= 1
        if (cancelled) {
          s.baselineText = ''
          s.committedText = ''
          s.currentText = ''
          s.dirty = false
          s.startedAt = null
          s.lastChangedAt = null
          s.maxLenSinceEdit = 0
          s.shrinkingSteps = 0
        } else {
          const seg = this._commit(nowMs, { clearField: true })
          if (seg) emitted.push(seg)
        }
      } else {
        s.baselineText = ''
        s.committedText = ''
        s.currentText = ''
      }
      s.peakFieldLength = 0
      return emitted
    }

    // Non-empty text changed.
    const prevText = s.currentText
    const prevLen = codePointLength(prevText)
    const currLen = codePointLength(rawTrimmed)
    if (s.dirty && currLen < prevLen && prevText.startsWith(rawTrimmed)) {
      s.shrinkingSteps += 1
    } else {
      s.shrinkingSteps = 0
    }

    s.currentText = rawTrimmed
    if (rawTrimmed === s.committedText) {
      s.dirty = false
      s.startedAt = null
      s.lastChangedAt = null
      s.maxLenSinceEdit = 0
      s.shrinkingSteps = 0
    } else {
      if (!s.dirty) {
        s.dirty = true
        s.startedAt = nowMs
        s.maxLenSinceEdit = currLen
      } else {
        s.maxLenSinceEdit = Math.max(s.maxLenSinceEdit, currLen)
      }
      s.lastChangedAt = nowMs
    }
    return emitted
  }

  flush(spanId, at = new Date()) {
    if (!this.state) return null
    if (spanId && this.state.spanId !== spanId) {
      this.state = null
      return null
    }
    const nowMs = at instanceof Date ? at.getTime() : Number(at)
    const seg = this._commit(nowMs)
    this.state = null
    return seg
  }
}

module.exports = {
  DEFAULT_PAUSE_FLUSH_MS,
  TextInputTracker,
}
