const {
  app,
  BrowserWindow,
  Notification,
  Menu,
  session,
  ipcMain,
  safeStorage,
  screen,
  nativeTheme,
  dialog,
} = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DesktopAgent } = require('./agent.cjs')
const { sampleActivity } = require('./activity.cjs')
const {
  captureForegroundWindow,
  enableWindowCapture,
} = require('./foreground-capture.cjs')
const { enableTextInputCapture } = require('./text-input-probe.cjs')
const { createDesktopPet } = require('./desktop-pet.cjs')
const appIcon = path.join(__dirname, app.isPackaged ? '../dist/app-icon.png' : '../public/app-icon.png')
let agent, appWindow, desktopPet

function windowBackground() {
  return nativeTheme.shouldUseDarkColors ? '#211f1e' : '#fbf9f5'
}

function windowControls() {
  return {
    // Let the native buttons share the background of the page or its modal overlay.
    color: '#00000000',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#f3eee8' : '#362f29',
    height: 44,
  }
}

function loadRenderer(win) {
  if (app.isPackaged || process.argv.includes('--preview'))
    return win.loadFile(path.join(__dirname, '../dist/index.html'))
  return win.loadURL('http://127.0.0.1:5173')
}

function createWindow() {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const width = Math.min(560, Math.floor(area.width * 0.9))
  const height = Math.min(680, Math.floor(area.height * 0.9))
  const win = new BrowserWindow({
    width, height,
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    minWidth: Math.min(380, width),
    minHeight: Math.min(460, height),
    title: 'Wintermute',
    icon: appIcon,
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
  win.on('closed', () => {
    desktopPet?.destroy()
    appWindow = null
  })
  void loadRenderer(win)
}

function presentNotifications(items, profile) {
  const win = appWindow
  if (!win || win.isDestroyed() || win.webContents.isLoadingMainFrame()) return false
  const latest = items[0]
  const title = items.length === 1 ? latest.title : items.length + ' 条新通知'
  const detail = items.length === 1 ? latest.body : latest.title
  const alert = { id: latest.id, title, body: detail, deviceId: profile.deviceId, url: profile.url,
    notifyAt: latest.notify_at ?? latest.created_at }
  const send = open => {
    if (agent.profile === profile && !win.isDestroyed())
      win.webContents.send('agent:notice', {...alert, open})
  }
  if (win.isFocused() || !Notification.isSupported()) send(false)
  else {
    try {
      const notice = new Notification({ title, body: detail.slice(0, 200) })
      notice.on('click', () => {
        if (agent.profile !== profile || win.isDestroyed()) return
        desktopPet.restore()
        send(true)
      })
      notice.on('failed', () => send(false))
      notice.show()
    } catch { send(false) }
  }
  return true
}

async function chooseAttachmentPath(name) {
  const result = await dialog.showSaveDialog(appWindow, {
    title: '保存附件',
    defaultPath: path.join(app.getPath('downloads'), name),
  })
  return result.canceled ? null : result.filePath
}

function start() {
  if (process.platform === 'win32') app.setAppUserModelId('dev.wintermute.desktop')
  if (process.platform === 'darwin' && !app.isPackaged) app.dock.setIcon(appIcon)
  agent = new DesktopAgent(
    app.getPath('userData'),
    safeStorage,
    sampleActivity,
    (state) => {
      if (nativeTheme.themeSource !== state.appearance)
        nativeTheme.themeSource = state.appearance
      if (appWindow && !appWindow.isDestroyed())
        appWindow.webContents.send('agent:changed', state)
      desktopPet?.publish(state)
    },
    captureForegroundWindow,
    presentNotifications,
  )
  nativeTheme.themeSource = agent.appearance
  desktopPet = createDesktopPet(agent, () => appWindow, loadRenderer)
  nativeTheme.on('updated', () => {
    if (!appWindow || appWindow.isDestroyed()) return
    appWindow.setBackgroundColor(windowBackground())
    if (process.platform !== 'darwin')
      appWindow.setTitleBarOverlay(windowControls())
  })
  const actions = {
    enterPetMode: () => desktopPet.enter(),
    downloadHistoryFile: file => agent.downloadHistoryFile(file, chooseAttachmentPath),
    downloadNotificationFile: file => agent.downloadNotificationFile(file, chooseAttachmentPath),
    async chooseObsidianVault() {
      const result = await dialog.showOpenDialog(appWindow, {
        title: '选择 Obsidian Vault 文件夹',
        properties: ['openDirectory'],
      })
      return result.canceled || !result.filePaths.length ? null : result.filePaths[0]
    },
    async screenshots(options) {
      if (options?.enabled && !agent.state().screenshotsEnabled) {
        const profile = agent.profile
        await enableWindowCapture()
        if (agent.profile !== profile) throw new Error('连接已更改')
      }
      agent.setScreenshots(options)
    },
    async textInput(options) {
      if (options?.enabled && !agent.state().textInputEnabled) {
        const profile = agent.profile
        enableTextInputCapture()
        if (agent.profile !== profile) throw new Error('连接已更改')
      }
      agent.setTextInput(options)
    },
  }
  for (const [channel, method] of Object.entries({
    state: 'state',
    loadEarlier: 'loadEarlier',
    schedule: 'schedule',
    connectors: 'connectors',
    setObsidianConnector: 'setObsidianConnector',
    ...(process.platform === 'darwin' && { setMacConnector: 'setMacConnector' }),
    addMcpConnector: 'addMcpConnector',
    saveConnectorCredentials: 'saveConnectorCredentials',
    testConnector: 'testConnector',
    deleteConnector: 'deleteConnector',
    notificationPage: 'notificationPage',
    readNotification: 'readNotification',
    answerQuestion: 'answerQuestion',
    dismissQuestion: 'dismissQuestion',
    previewHistoryImage: 'previewHistoryImage',
    configure: 'configure',
    pair: 'pair',
    send: 'send',
    transcribe: 'transcribe',
    uploadChatFile: 'uploadChatFile',
    retry: 'retry',
    collection: 'setCollection',
    remoteCommands: 'setRemoteCommands',
    appearance: 'setAppearance',
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
  const chatUrl = app.isPackaged || process.argv.includes('--preview')
    ? pathToFileURL(path.join(__dirname, '../dist/index.html')).href : 'http://127.0.0.1:5173/'
  const isVoiceFrame = (contents, permission, details) =>
    permission === 'media' && contents &&
    (contents === appWindow?.webContents || desktopPet.isActiveContents(contents)) &&
    details.isMainFrame && details.requestingUrl === chatUrl && contents.getURL() === chatUrl
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    Boolean(isVoiceFrame(contents, permission, details) && details.mediaType === 'audio'))
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(Boolean(isVoiceFrame(contents, permission, details) &&
      details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio')))
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
    if (!appWindow) createWindow()
    else desktopPet.restore()
  })
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (appWindow && !appWindow.isDestroyed()) {
      desktopPet.restore()
    } else if (app.isReady()) createWindow()
  })
  app.whenReady().then(start)
} else {
  app.quit()
}
app.on('before-quit', () => {
  desktopPet?.destroy()
  agent?.close()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
