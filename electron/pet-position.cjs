const { read } = require('./json-file.cjs')

const insetX = 36, insetY = 42

function readPosition(file) {
  try {
    const p = read(file, null)
    if (Number.isSafeInteger(p?.displayId) &&
      [p.x, p.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return p
  } catch (error) {
    console.warn('Could not read the desktop pet position:', error.message)
  }
  return null
}

// Store fractions of the usable travel on a display, independent of its desktop origin.
function petAnchor(area, position) {
  const x = Math.min(insetX, area.width / 2), y = Math.min(insetY, area.height / 2)
  return {
    x: Math.round(x + (position?.x ?? .5) * (area.width - 2 * x)),
    y: Math.round(y + (position?.y ?? 0) * (area.height - 2 * y)),
  }
}

function positionAt(display, point) {
  const area = display.workArea
  function fraction(offset, extent, inset) {
    if (extent <= 2 * inset) return .5
    return Math.max(0, Math.min(1, (offset - inset) / (extent - 2 * inset)))
  }
  return {
    displayId: display.id,
    x: fraction(point.x - area.x, area.width, insetX),
    y: fraction(point.y - area.y, area.height, insetY),
  }
}

module.exports = { readPosition, petAnchor, positionAt }
