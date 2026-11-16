const { desktopCapturer, nativeImage, systemPreferences } = require('electron')
const { visualSignature } = require('./representative-frames.cjs')
const { captureWindowsWindow } = require('./window-shot.cjs')

async function listShareWindows() {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  })
  return sources.map(({ id, name }) => ({ id, name }))
}

async function captureShareWindow(id) {
  if (typeof id !== 'string' || !/^(screen|window):-?\d+:-?\d+$/.test(id))
    throw new Error('请选择一个可用的窗口或屏幕')
  const sources = await desktopCapturer.getSources({
    types: [id.startsWith('screen:') ? 'screen' : 'window'],
    thumbnailSize: { width: 1920, height: 1920 },
    fetchWindowIcons: false,
  })
  if (
    process.platform === 'darwin' &&
    ['denied', 'restricted'].includes(
      systemPreferences.getMediaAccessStatus('screen'),
    )
  )
    throw new Error('请在系统设置中允许 Wintermute 录制屏幕，或粘贴一张截图')
  const source = sources.find((item) => item.id === id)
  if (!source || source.thumbnail.isEmpty())
    throw new Error('窗口已关闭或无法截图，请重新选择')
  const bytes = source.thumbnail.toJPEG(82)
  if (!bytes.length || bytes.length > 4 * 1024 * 1024)
    throw new Error('截图过大，请选择较小的窗口')
  return 'data:image/jpeg;base64,' + bytes.toString('base64')
}

async function enableWindowCapture() {
  if (process.platform !== 'darwin') return
  if (systemPreferences.getMediaAccessStatus('screen') === 'not-determined') {
    await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
    })
  }
  if (systemPreferences.getMediaAccessStatus('screen') !== 'granted')
    throw new Error(
      '请在 macOS 系统设置的“隐私与安全性 → 录屏”中允许 Wintermute，然后重新开启代表帧采集',
    )
}

// Electron's window source ID contains the native HWND/CGWindowID. Never
// substitute a similarly named window or a whole screen when it disappears.
async function captureForegroundWindow(target) {
  let jpegBase64 = process.platform === 'win32'
    ? await captureWindowsWindow(target.id, target.pid)
    : (await captureShareWindow('window:' + target.id + ':0')).slice('data:image/jpeg;base64,'.length)
  const image = nativeImage.createFromBuffer(Buffer.from(jpegBase64, 'base64'))
  if (image.isEmpty()) throw new Error('前台截图无法解码')
  // One window observation can carry four JPEGs. Keep their base64 JSON
  // under the service's 8 MiB reverse-proxy limit, including dense photos.
  if (Buffer.byteLength(jpegBase64, 'base64') > 1024 * 1024) {
    let width = image.getSize().width
    let bytes
    do {
      width = Math.max(1, Math.floor(width * 0.8))
      bytes = image.resize({ width, quality: 'good' }).toJPEG(80)
    } while (bytes.length > 1024 * 1024 && width > 1)
    jpegBase64 = bytes.toString('base64')
  }
  return { jpegBase64, signature: visualSignature(image) }
}

module.exports = {
  listShareWindows,
  captureShareWindow,
  captureForegroundWindow,
  enableWindowCapture,
}
