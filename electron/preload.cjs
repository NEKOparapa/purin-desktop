const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wintermute', {
  initialAppearance:
    process.argv
      .find((arg) => arg.startsWith('--wintermute-appearance='))
      ?.split('=')[1] || 'system',
  state: () => ipcRenderer.invoke('agent:state'),
  loadEarlier: () => ipcRenderer.invoke('agent:loadEarlier'),
  schedule: (options) => ipcRenderer.invoke('agent:schedule', options),
  memoryTree: () => ipcRenderer.invoke('agent:memoryTree'),
  memoryFile: (path) => ipcRenderer.invoke('agent:memoryFile', path),
  recordItems: (options) => ipcRenderer.invoke('agent:recordItems', options),
  recordContent: (options) => ipcRenderer.invoke('agent:recordContent', options),
  apiKeys: () => ipcRenderer.invoke('agent:apiKeys'),
  updateApiKey: (options) => ipcRenderer.invoke('agent:updateApiKey', options),
  notificationPage: (cursor) => ipcRenderer.invoke('agent:notificationPage', cursor),
  readNotification: (id) => ipcRenderer.invoke('agent:readNotification', id),
  downloadNotificationFile: (file) => ipcRenderer.invoke('agent:downloadNotificationFile', file),
  onNotice: (callback) => {
    const listener = (_event, notice) => callback(notice)
    ipcRenderer.on('agent:notice', listener)
    return () => ipcRenderer.removeListener('agent:notice', listener)
  },
  history: (options) => ipcRenderer.invoke('agent:history', options),
  terminalToolHistory: (cursor) => ipcRenderer.invoke('agent:terminalToolHistory', cursor),
  previewHistoryImage: (options) => ipcRenderer.invoke('agent:previewHistoryImage', options),
  compression: (options) => ipcRenderer.invoke('agent:compression', options),
  downloadHistoryFile: (file) =>
    ipcRenderer.invoke('agent:downloadHistoryFile', file),
  configure: (options) => ipcRenderer.invoke('agent:configure', options),
  send: (text) => ipcRenderer.invoke('agent:send', text),
  retry: (id) => ipcRenderer.invoke('agent:retry', id),
  setCollection: (enabled) => ipcRenderer.invoke('agent:collection', enabled),
  setRemoteCommands: (options) => ipcRenderer.invoke('agent:remoteCommands', options),
  setScreenshots: (options) => ipcRenderer.invoke('agent:screenshots', options),
  setAppearance: (mode) => ipcRenderer.invoke('agent:appearance', mode),
  manageFailed: (id, retry) =>
    ipcRenderer.invoke('agent:manageFailed', { id, retry }),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('agent:changed', listener)
    return () => ipcRenderer.removeListener('agent:changed', listener)
  },
})
