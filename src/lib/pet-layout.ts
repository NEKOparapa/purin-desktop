type Size = { width: number; height: number }
type Point = { x: number; y: number }

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

export function layoutPet(
  viewport: Size, anchor: Point, preferredSide: 'left' | 'right',
  composer?: Size, bubble?: Size,
) {
  const pad = 6
  const { width, height } = viewport
  let left = anchor.x - 52, right = anchor.x + 52
  let top = anchor.y - 40, bottom = anchor.y + 40
  const editorWidth = composer?.width ?? 0, editorHeight = composer?.height ?? 0
  const composerLeft = clamp(anchor.x - editorWidth / 2, pad, width - editorWidth - pad)
  const editorBelow = bottom + editorHeight + pad <= height
  const composerTop = clamp(editorBelow ? bottom : top - editorHeight, pad, height - editorHeight - pad)
  if (composer) {
    left = Math.min(left, composerLeft - pad)
    right = Math.max(right, composerLeft + editorWidth + pad)
    top = Math.min(top, composerTop - pad)
    bottom = Math.max(bottom, composerTop + editorHeight + pad)
  }

  let bubbleX = 0, bubbleY = 0, bubbleMaxHeight = height
  let side: 'left' | 'right' | 'above' | 'below' = preferredSide
  if (bubble) {
    bubbleY = clamp(anchor.y - 34, pad, height - bubble.height - pad)
    let leftEdge = anchor.x - 44, rightEdge = anchor.x + 44
    if (composer && bubbleY < composerTop + editorHeight + pad &&
      bubbleY + bubble.height + pad > composerTop) {
      // A small nudge keeps a short reply close to the face.
      const besideY = editorBelow ? composerTop - bubble.height - pad : composerTop + editorHeight + pad
      if (Math.abs(besideY - bubbleY) <= pad && besideY >= 0 && besideY + bubble.height <= height) {
        bubbleY = besideY
      } else {
        leftEdge = Math.min(leftEdge, composerLeft - 18)
        rightEdge = Math.max(rightEdge, composerLeft + editorWidth + 18)
      }
    }
    const fitsLeft = leftEdge - bubble.width >= pad
    const fitsRight = rightEdge + bubble.width <= width - pad
    if (fitsLeft || fitsRight) {
      if (!fitsLeft) side = 'right'
      if (!fitsRight) side = 'left'
      bubbleX = side === 'left' ? leftEdge - bubble.width : rightEdge
    } else {
      const above = Math.max(0, top - 12 - pad), below = Math.max(0, height - pad - bottom - 12)
      side = below >= bubble.height || (above < bubble.height && below >= above) ? 'below' : 'above'
      bubbleMaxHeight = side === 'below' ? below : above
      bubbleY = side === 'below' ? bottom + 12 : top - 12 - Math.min(bubble.height, above)
      bubbleX = clamp(anchor.x - bubble.width / 2, pad, width - bubble.width - pad)
    }
    left = Math.min(left, bubbleX - pad)
    right = Math.max(right, bubbleX + bubble.width + pad)
    top = Math.min(top, bubbleY - pad)
    bottom = Math.max(bottom, bubbleY + Math.min(bubble.height, bubbleMaxHeight) + pad)
  }
  const x = Math.max(0, Math.floor(left)), y = Math.max(0, Math.floor(top))
  return {
    composerLeft, composerTop, bubbleX, bubbleY, bubbleMaxHeight, side,
    tailX: clamp(anchor.x - bubbleX - 8, 12, (bubble?.width ?? 0) - 26),
    tailY: clamp(anchor.y - bubbleY - 9, 8, (bubble?.height ?? 0) - 22),
    region: {
      x, y, width: Math.min(width, Math.ceil(right)) - x,
      height: Math.min(height, Math.ceil(bottom)) - y,
    },
  }
}
