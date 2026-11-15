const { desktopCapturer, systemPreferences } = require('electron')
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
      '请在 macOS 系统设置的“隐私与安全性 → 录屏”中允许 Wintermute，然后重新开启定时截图',
    )
}

// Electron's window source ID contains the native HWND/CGWindowID. Never
// substitute a similarly named window or a whole screen when it disappears.
async function captureForegroundWindow(target) {
  if (process.platform === 'win32')
    return captureWindowsWindow(target.id, target.pid)
  const dataUrl = await captureShareWindow('window:' + target.id + ':0')
  return dataUrl.slice('data:image/jpeg;base64,'.length)
}

module.exports = {
  listShareWindows,
  captureShareWindow,
  captureForegroundWindow,
  enableWindowCapture,
}
