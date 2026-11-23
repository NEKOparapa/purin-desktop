type Size = { width: number; height: number }
type Point = { x: number; y: number }
type BubbleSide = 'left' | 'right' | 'above' | 'below'

const tailLength = 16

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

// Draw the balloon with its tail on the near edge. u runs along that edge,
// v runs into the balloon; mapping both axes keeps the text itself upright.
function bubbleOutline({ width, height }: Size, side: BubbleSide, target: Point) {
  const vertical = side === 'left' || side === 'right'
  const span = vertical ? height : width
  const depth = vertical ? width : height
  const point = (u: number, v: number): Point => vertical
    ? { x: side === 'right' ? v : width - v, y: u }
    : { x: u, y: side === 'below' ? v : height - v }
  const at = (u: number, v: number) => {
    const { x, y } = point(u, v)
    return `${x} ${y}`
  }
  const r = Math.min(19, span * .28, depth * .3)
  const half = Math.min(9, span * .17)
  const center = clamp((vertical ? target.y : target.x) + 6, r + half, span - r - half)
  const base = point(center, 1)
  const dx = target.x - base.x, dy = target.y - base.y
  const reach = Math.min(1, tailLength / Math.hypot(dx, dy))
  const tip = { x: base.x + dx * reach, y: base.y + dy * reach }
  const path = [
    `M ${at(r, 1)} L ${at(center - half, 1)}`,
    `Q ${at(center - half * .5, -1)} ${tip.x} ${tip.y}`,
    `Q ${at(center + half * .35, -3)} ${at(center + half, 1)}`,
    `L ${at(span - r, 1)} Q ${at(span - 1, 1)} ${at(span - 1, r)}`,
    `L ${at(span - 1, depth - r)} Q ${at(span - 1, depth - 1)} ${at(span - r, depth - 1)}`,
    `L ${at(r, depth - 1)} Q ${at(1, depth - 1)} ${at(1, depth - r)}`,
    `L ${at(1, r)} Q ${at(1, 1)} ${at(r, 1)} Z`,
  ].join(' ')
  return { path, base, tip }
}

export function layoutPet(
  viewport: Size, anchor: Point, preferredSide: 'left' | 'right',
  composer?: Size, bubble?: Size,
) {
  const pad = 6
  const tailGap = tailLength + pad
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
  let side: BubbleSide = preferredSide
  let outline: ReturnType<typeof bubbleOutline> | undefined
  if (bubble) {
    bubbleY = clamp(anchor.y - 34, pad, height - bubble.height - pad)
    let leftEdge = anchor.x - 44, rightEdge = anchor.x + 44
    if (composer && bubbleY < composerTop + editorHeight + pad &&
      bubbleY + bubble.height + pad > composerTop) {
      // Keep the reply beside the face when it fits on the free side of the editor.
      const besideY = editorBelow ? composerTop - bubble.height - pad : composerTop + editorHeight + pad
      if (besideY >= 0 && besideY + bubble.height <= height) {
        bubbleY = besideY
      } else {
        leftEdge = Math.min(leftEdge, composerLeft - tailGap)
        rightEdge = Math.max(rightEdge, composerLeft + editorWidth + tailGap)
      }
    }
    const fitsLeft = leftEdge - bubble.width >= pad
    const fitsRight = rightEdge + bubble.width <= width - pad
    if (fitsLeft || fitsRight) {
      if (!fitsLeft) side = 'right'
      if (!fitsRight) side = 'left'
      bubbleX = side === 'left' ? leftEdge - bubble.width : rightEdge
    } else {
      const above = Math.max(0, top - tailGap - pad), below = Math.max(0, height - pad - bottom - tailGap)
      if (above >= bubble.height && below >= bubble.height) {
        side = composer && editorBelow ? 'above' : 'below'
      } else {
        side = below >= bubble.height || (above < bubble.height && below >= above) ? 'below' : 'above'
      }
      bubbleMaxHeight = side === 'below' ? below : above
      bubbleY = side === 'below' ? bottom + tailGap : top - tailGap - Math.min(bubble.height, above)
      bubbleX = clamp(anchor.x - bubble.width / 2, pad, width - bubble.width - pad)
    }
    const visibleHeight = Math.min(bubble.height, bubbleMaxHeight)
    outline = bubbleOutline({ width: bubble.width, height: visibleHeight }, side, {
      x: anchor.x - bubbleX, y: anchor.y - bubbleY,
    })
    left = Math.min(left, bubbleX - pad)
    right = Math.max(right, bubbleX + bubble.width + pad)
    top = Math.min(top, bubbleY - pad)
    bottom = Math.max(bottom, bubbleY + visibleHeight + pad)
  }
  const x = Math.max(0, Math.floor(left)), y = Math.max(0, Math.floor(top))
  return {
    composerLeft, composerTop, bubbleX, bubbleY, bubbleMaxHeight, side,
    outline,
    region: {
      x, y, width: Math.min(width, Math.ceil(right)) - x,
      height: Math.min(height, Math.ceil(bottom)) - y,
    },
  }
}
