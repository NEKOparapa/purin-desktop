const assert = require('node:assert/strict')
const test = require('node:test')
const { layoutPet } = require('../src/lib/pet-layout.ts')
const { petAnchor, positionAt } = require('./pet-position.cjs')

const composer = { width: 316, height: 44 }
function topLayout(width, side, editor, bubble) {
  return layoutPet({ width, height: 800 }, { x: width / 2, y: 40 }, side, editor, bubble)
}

test('a short reply points to the pet while the composer stays anchored below', () => {
  const bubble = { width: 240, height: 70 }
  for (const side of ['left', 'right']) {
    const layout = topLayout(1024, side, composer, bubble)
    assert.equal(layout.side, side)
    const x = layout.bubbleX - 1024 / 2
    assert.equal(side === 'right' ? x : -(x + bubble.width), 44)
    assert.ok(layout.bubbleY + bubble.height < layout.composerTop)
    assert.equal(
      layout.composerTop,
      topLayout(1024, side, composer).composerTop,
    )
  }
})

test('a tall reply clears the input on either side and goes below on a narrow display', () => {
  const bubble = { width: 264, height: 180 }
  for (const side of ['left', 'right']) {
    const layout = topLayout(1024, side, composer, bubble)
    const left = layout.bubbleX - 1024 / 2
    assert.ok(
      left > composer.width / 2 || left + bubble.width < -composer.width / 2,
    )
    const narrow = topLayout(380, side, composer, bubble)
    assert.equal(narrow.side, 'below')
    assert.ok(narrow.bubbleY > narrow.composerTop + composer.height)
    assert.ok(narrow.region.x + narrow.region.width <= 380)
    assert.equal(narrow.composerTop, layout.composerTop)
  }
})

test('opening the editor expands the hit region around the same avatar center', () => {
  for (const width of [319, 900]) {
    const idle = topLayout(width, 'right').region
    const open = topLayout(width, 'right', { ...composer, width: Math.min(316, width - 16) }).region
    assert.equal(idle.x + idle.width / 2, width / 2)
    assert.equal(open.x + open.width / 2, width / 2)
    assert.ok(open.width > idle.width && open.height > idle.height)
  }
})

test('a dragged position survives display relocation and fits a resized work area', () => {
  const workArea = { x: -1600, y: -200, width: 1600, height: 900 }
  const display = { id: 23, workArea }
  const saved = positionAt(display, { x: -400, y: 486 })
  assert.equal(saved.displayId, 23)
  assert.deepEqual(petAnchor(workArea, saved), { x: 1200, y: 686 })
  assert.deepEqual(petAnchor({ ...workArea, x: 500, y: 60 }, saved), { x: 1200, y: 686 })
  const edge = positionAt(display, { x: 700, y: 1800 })
  assert.deepEqual(petAnchor({ width: 800, height: 500 }, edge), { x: 764, y: 458 })
})

test('the editor and bubble stay visible and separate at edges and corners', () => {
  const bubble = { width: 250, height: 180 }
  for (const width of [360, 800, 1440]) {
    const height = 600
    for (const x of [36, width / 2, width - 36]) {
      for (const y of [42, height / 2, height - 42]) {
        const p = layoutPet({ width, height }, { x, y }, 'right', composer, bubble)
        const bh = Math.min(bubble.height, p.bubbleMaxHeight)
        assert.ok(p.composerLeft >= 0 && p.composerLeft + composer.width <= width)
        assert.ok(p.composerTop >= 0 && p.composerTop + composer.height <= height)
        assert.ok(p.bubbleX >= 0 && p.bubbleX + bubble.width <= width)
        assert.ok(p.bubbleY >= 0 && p.bubbleY + bh <= height)
        assert.ok(p.bubbleX + bubble.width <= p.composerLeft ||
          p.bubbleX >= p.composerLeft + composer.width ||
          p.bubbleY + bh <= p.composerTop || p.bubbleY >= p.composerTop + composer.height)
        assert.ok(p.region.x <= x && p.region.x + p.region.width >= x)
        assert.ok(p.region.y <= y && p.region.y + p.region.height >= y)
      }
    }
  }
})
