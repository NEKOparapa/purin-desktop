function createWindowLifecycle({
  getCloseAction,
  getWindow,
  createWindow,
  restorePet,
  quit,
  platform = process.platform,
  dock,
}) {
  let quitting = false

  function showInterface() {
    if (platform === 'darwin') dock?.show()
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      restorePet()
    } else {
      createWindow()
    }
  }

  function exitApplication() {
    quitting = true
    quit()
  }

  function handleWindowClose(event, win = getWindow()) {
    if (quitting) return
    if (getCloseAction() === 'tray') {
      event.preventDefault()
      win?.hide()
      if (platform === 'darwin') dock?.hide()
      return
    }
    quitting = true
  }

  function markQuitting() {
    quitting = true
  }

  function isQuitting() {
    return quitting
  }

  function trayMenuTemplate() {
    return [
      { label: '显示界面', click: () => showInterface() },
      { label: '退出应用', click: () => exitApplication() },
    ]
  }

  return {
    showInterface,
    exitApplication,
    handleWindowClose,
    markQuitting,
    isQuitting,
    trayMenuTemplate,
  }
}

module.exports = { createWindowLifecycle }
