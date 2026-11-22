// Regenerate the checked-in atlas with: npx electron scripts/render-mascot.cjs
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const path = require('node:path')

function paintSheet() {
  const tile = 192, frames = 12
  const poses = ['blink', 'peek', 'doze', 'listen', 'think', 'talk', 'carry']
  const sheet = document.createElement('canvas')
  sheet.width = tile * frames
  sheet.height = tile * poses.length
  const ctx = sheet.getContext('2d')
  const ink = '#463632', fur = '#fff6e3', ginger = '#eb945e', blush = '#f4b3a1'
  function shape(outline, fill, stroke = ink, width = 2.8) {
    const path = new Path2D(outline)
    if (fill) { ctx.fillStyle = fill; ctx.fill(path) }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(path) }
  }
  function oval(x, y, rx, ry, color) {
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI)
    ctx.fillStyle = color
    ctx.fill()
  }
  function turn(x, y, angle) {
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.translate(-x, -y)
  }
  // A seated dumpling-shaped cat with one marmalade ear and a little neckerchief.
  function paint(pose, frame) {
    const phase = frame * 2 * Math.PI / frames
    const sway = Math.sin(phase), rise = (1 - Math.cos(phase)) / 2
    const peeking = pose === 'peek', sleepy = pose === 'doze'
    const listening = pose === 'listen', thinking = pose === 'think', talking = pose === 'talk'
    const carried = pose === 'carry'
    if (carried) turn(46, 19, .08 * sway)
    // The tail swings behind the body from its base.
    ctx.save()
    turn(68, 80, carried ? -.24 + .18 * sway : (peeking ? .24 : .085) * sway)
    const tail = 'M63 81 C75 84 87 76 85 66 C83 59 89 57 92 63 C99 81 81 94 65 90 Z'
    shape(tail, ginger)
    shape('M85 68 Q89 69 93 66', null, '#a75d46', 2.5)
    ctx.restore()
    if (carried) {
      shape('M29 58 Q23 70 29 83 L29 92 Q29 99 35 98 Q39 98 40 87 Q48 90 56 87 L58 94 Q60 99 65 96 Q68 94 66 84 Q73 70 63 58 Z', fur)
    } else {
      shape('M27 59 C19 66 16 76 19 83 Q19 88 26 88 Q26 94 35 92 L40 90 Q50 93 58 90 Q66 94 72 89 Q78 88 77 81 Q77 67 66 59 Z', fur)
      shape('M27 72 Q24 78 28 81 M54 84 Q52 88 54 90', null, ink, 2)
    }
    shape('M57 63 Q69 62 72 70 L63 69 L66 76 Q57 75 54 68', ginger, ink, 2)
    shape('M26 60 Q46 65 68 58 L66 66 Q47 74 25 65 Z', '#e98061', ink, 2.4)
    if (carried) {
      ctx.save()
      turn(32, 64, .15 * sway)
      shape('M26 61 Q21 65 21 74 Q21 81 26 81 Q30 81 32 72 L34 64', fur)
      ctx.restore()
      ctx.save()
      turn(63, 62, .15 * sway)
      shape('M60 63 L62 73 Q64 80 69 78 Q73 76 70 68 L67 61', fur)
      ctx.restore()
    }
    ctx.save()
    ctx.translate(0, sleepy ? 2 * rise : talking ? -1.4 * rise : -.75 * rise)
    const lean = listening ? -.17 - .045 * rise : thinking ? .115 + .04 * sway :
      peeking ? .15 * sway : sleepy ? .095 * rise : talking ? .04 * sway : 0
    turn(47, 62, lean)
    const head = 'M14 40 Q16 34 18 31 Q17 20 19 12 Q20 7 25 10 L38 19 Q48 16 58 19 L71 10 Q76 7 78 13 Q80 21 78 32 Q84 40 83 49 Q85 58 77 62 Q67 68 48 68 Q27 69 16 63 Q8 59 11 50 Q9 45 14 40 Z'
    shape(head, fur)
    ctx.save()
    ctx.clip(new Path2D(head))
    shape('M53 16 Q56 26 64 31 Q67 33 69 37 Q72 40 74 34 L75 31 Q82 34 84 28 L81 5 Z', ginger, null)
    ctx.restore()
    shape(head, null)
    shape('M22 25 L22 15 Q27 17 30 21', blush, null)
    shape('M68 22 L74 15 L74 25 Z', '#df8f79', null)
    // Give the dozing cat a slowly closing eyelid; dot eyes remain bold at 32px.
    const eyes = sleepy ? Math.max(.08, 1 - 1.65 * rise) :
      (pose === 'blink' && frame === 8 ? .12 : 1)
    const gaze = peeking ? 2.8 * sway : listening ? -1.5 : thinking ? 2 : 0
    oval(24, 51, 5.5, 2.8, blush)
    oval(69, 50, 5.4, 2.8, blush)
    oval(33 + gaze, 44.5 - Number(thinking) * 2, 3.1, 3.65 * eyes, ink)
    oval(58 + gaze, 44 - Number(thinking) * 2, 3.1, 3.65 * eyes, ink)
    if (talking || (sleepy && frame >= 4 && frame <= 8)) {
      const opening = talking ? 1.7 + 3.6 * Math.abs(Math.sin(phase)) : 2.3
      oval(46, 53, 3.8, opening, ink)
      if (opening > 3) oval(46, 53 + opening * .49, 2.1, 1.3, '#fcac96')
    } else if (carried) {
      oval(46, 53, 2.7, 3.3, ink)
    } else if (thinking) {
      shape('M43 52 Q46 50 49 52', null, ink, 2.4)
    } else {
      shape('M40 51 Q42 56 46 51 Q49 55 52 51', null, ink, 2.3)
    }
    shape('M9 47 L17 49 M9 55 L17 54 M77 47 L85 44 M77 53 L85 55', null, ink, 2)
    ctx.restore()
    if (thinking) {
      shape('M51 76 Q50 69 54 61 C57 55 63 57 62 62 Q66 61 65 66 Q62 74 57 78', fur, ink, 2.6)
      for (let dot = 0; dot < 3; dot++) {
        const pulse = (1 + Math.cos(phase - dot * 1.3)) / 2
        oval(43 + dot * 7, 11 - dot * 2 - pulse, 1.6 + pulse, 1.6 + pulse, ink)
      }
    } else if (listening) {
      shape('M65 75 Q63 69 67 60 Q70 53 74 55 Q77 55 76 60 Q80 59 79 65 Q77 72 71 76', fur, ink, 2.6)
      shape('M84 27 Q89 23 89 17 M87 32 Q95 29 96 22', null, '#c77352', 2.6)
    } else if (talking) {
      ctx.save()
      turn(65, 73, .18 * sway)
      shape('M60 74 Q61 65 69 61 Q75 58 76 63 Q81 63 78 68 Q74 76 66 78', fur, ink, 2.6)
      ctx.restore()
      shape('M83 35 L89 31 M85 39 L92 39', null, '#c77352', 2.4)
    }
  }
  poses.forEach((pose, row) => {
    for (let frame = 0; frame < frames; frame++) {
      ctx.save()
      ctx.translate(frame * tile, row * tile)
      ctx.scale(tile / 104, tile / 104)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      paint(pose, frame)
      ctx.restore()
    }
  })
  return sheet.toDataURL('image/webp', .98).split(',')[1]
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await win.loadURL('about:blank')
  const image = await win.webContents.executeJavaScript('(' + paintSheet.toString() + ')()')
  writeFileSync(path.join(__dirname, '../src/assets/mascot-poses.webp'), Buffer.from(image, 'base64'))
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
