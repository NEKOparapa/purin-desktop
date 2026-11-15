const {
  app,
  BrowserWindow,
  Menu,
  session,
  ipcMain,
  safeStorage,
  nativeTheme,
  clipboard,
  dialog,
  shell,
} = require('electron')
const path = require('node:path')
const { DesktopAgent } = require('./agent.cjs')
const { sampleActivity } = require('./activity.cjs')
const {
  listShareWindows,
  captureShareWindow,
  captureForegroundWindow,
  enableWindowCapture,
} = require('./share.cjs')
let agent, appWindow

function windowBackground() {
  return nativeTheme.shouldUseDarkColors ? '#16171b' : '#ffffff'
}

function windowControls() {
  return {
    color: windowBackground(),
    symbolColor: nativeTheme.shouldUseDarkColors ? '#f1f2f5' : '#20222a',
    height: 32,
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 860,
    minHeight: 680,
    title: 'Wintermute',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : windowControls(),
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: ['--wintermute-appearance=' + agent.appearance],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  appWindow = win
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  if (app.isPackaged || process.argv.includes('--preview')) {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    win.loadURL('http://127.0.0.1:5173')
  }
}

function start() {
  agent = new DesktopAgent(
    app.getPath('userData'),
    safeStorage,
    sampleActivity,
    (state) => {
      if (nativeTheme.themeSource !== state.appearance)
        nativeTheme.themeSource = state.appearance
      if (appWindow && !appWindow.isDestroyed())
        appWindow.webContents.send('agent:changed', state)
    },
    captureForegroundWindow,
  )
  nativeTheme.themeSource = agent.appearance
  nativeTheme.on('updated', () => {
    if (!appWindow || appWindow.isDestroyed()) return
    appWindow.setBackgroundColor(windowBackground())
    if (process.platform !== 'darwin')
      appWindow.setTitleBarOverlay(windowControls())
  })
  const actions = {
    downloadHistoryFile: (file) =>
      agent.downloadHistoryFile(file, async (name) => {
        const result = await dialog.showSaveDialog(appWindow, {
          title: '保存附件',
          defaultPath: path.join(app.getPath('downloads'), name),
        })
        return result.canceled ? null : result.filePath
      }),
    async screenshots(options) {
      if (options?.enabled && !agent.state().screenshotsEnabled) {
        const profile = agent.profile
        await enableWindowCapture()
        if (agent.profile !== profile) throw new Error('连接已更改')
      }
      agent.setScreenshots(options)
    },
    copyPairing: () => clipboard.writeText(agent.pairingCode()),
    async extensionFolder() {
      const dir = app.isPackaged
        ? path.join(process.resourcesPath, 'browser-extension')
        : path.join(__dirname, '../browser-extension')
      if (await shell.openPath(dir)) throw new Error('无法打开扩展文件夹')
    },
    listShareWindows,
    captureShareWindow,
  }
  for (const [channel, method] of Object.entries({
    state: 'state',
    schedule: 'schedule',
    history: 'history',
    compression: 'compression',
    configure: 'configure',
    send: 'send',
    retry: 'retry',
    collection: 'setCollection',
    appearance: 'setAppearance',
    browser: 'setBrowser',
    shareMaterial: 'shareMaterial',
    manageFailed: 'manageFailed',
    ...Object.fromEntries(Object.keys(actions).map((key) => [key, key])),
  })) {
    ipcMain.handle('agent:' + channel, (event, arg) => {
      if (
        appWindow?.isDestroyed() ||
        event.sender !== appWindow?.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error('无效窗口')
      return Object.hasOwn(actions, channel)
        ? actions[channel](arg)
        : agent[method](arg)
    })
  }
  const ownFrame = (contents, details) =>
    contents &&
    contents === appWindow?.webContents &&
    details.isMainFrame &&
    details.requestingUrl === contents.getURL()
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      !!(
        permission === 'media' &&
        ownFrame(contents, details) &&
        details.mediaType === 'audio'
      ),
  )
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(
        !!(
          permission === 'media' &&
          ownFrame(contents, details) &&
          details.mediaTypes?.length === 1 &&
          details.mediaTypes[0] === 'audio'
        ),
      ),
  )
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([
          { role: 'appMenu' },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
        ])
      : null,
  )
  createWindow()
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow()
  })
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (appWindow && !appWindow.isDestroyed()) {
      if (appWindow.isMinimized()) appWindow.restore()
      appWindow.show()
      appWindow.focus()
    } else if (app.isReady()) createWindow()
  })
  app.whenReady().then(start)
} else {
  app.quit()
}
app.on('before-quit', () => agent?.close())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
