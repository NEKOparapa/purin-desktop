const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('purin', {
  initialAppearance:
    process.argv
      .find((arg) => arg.startsWith('--purin-appearance='))
      ?.split('=')[1] === 'dark'
      ? 'dark'
      : 'light',
  state: () => ipcRenderer.invoke('agent:state'),
  enterPetMode: () => ipcRenderer.invoke('agent:enterPetMode'),
  onPetSettings(callback) {
    const listener = () => callback()
    ipcRenderer.on('pet:open-settings', listener)
    return () => ipcRenderer.removeListener('pet:open-settings', listener)
  },
  loadEarlier: () => ipcRenderer.invoke('agent:loadEarlier'),
  schedule: (options) => ipcRenderer.invoke('agent:schedule', options),
  connectors: () => ipcRenderer.invoke('agent:connectors'),
  chooseObsidianVault: () => ipcRenderer.invoke('agent:chooseObsidianVault'),
  setObsidianConnector: (options) => ipcRenderer.invoke('agent:setObsidianConnector', options),
  ...(process.platform === 'darwin' && {
    setMacConnector: options => ipcRenderer.invoke('agent:setMacConnector', options),
  }),
  addMcpConnector: (payload) => ipcRenderer.invoke('agent:addMcpConnector', payload),
  saveConnectorCredentials: (payload) => ipcRenderer.invoke('agent:saveConnectorCredentials', payload),
  testConnector: (id) => ipcRenderer.invoke('agent:testConnector', id),
  deleteConnector: (id) => ipcRenderer.invoke('agent:deleteConnector', id),
  notificationPage: (cursor) => ipcRenderer.invoke('agent:notificationPage', cursor),
  readNotification: (id) => ipcRenderer.invoke('agent:readNotification', id),
  answerQuestion: (payload) => ipcRenderer.invoke('agent:answerQuestion', payload),
  dismissQuestion: (id) => ipcRenderer.invoke('agent:dismissQuestion', id),
  downloadNotificationFile: (file) => ipcRenderer.invoke('agent:downloadNotificationFile', file),
  onNotice: (callback) => {
    const listener = (_event, notice) => callback(notice)
    ipcRenderer.on('agent:notice', listener)
    return () => ipcRenderer.removeListener('agent:notice', listener)
  },
  previewHistoryImage: (options) => ipcRenderer.invoke('agent:previewHistoryImage', options),
  downloadHistoryFile: (file) =>
    ipcRenderer.invoke('agent:downloadHistoryFile', file),
  configure: (options) => ipcRenderer.invoke('agent:configure', options),
  pair: (options) => ipcRenderer.invoke('agent:pair', options),
  uploadChatFile: (name, data, revision) => ipcRenderer.invoke('agent:uploadChatFile', { name, data, revision }),
  send: (text, images, documents, imageNames, revision) => ipcRenderer.invoke('agent:send', { text, images, documents, imageNames, revision }),
  transcribe: (audio, connectionRevision) => ipcRenderer.invoke('agent:transcribe', { audio, connectionRevision }),
  retry: (id) => ipcRenderer.invoke('agent:retry', id),
  setCollection: (enabled) => ipcRenderer.invoke('agent:collection', enabled),
  setRemoteCommands: (options) => ipcRenderer.invoke('agent:remoteCommands', options),
  setScreenshots: (options) => ipcRenderer.invoke('agent:screenshots', options),
  setTextInput: (options) => ipcRenderer.invoke('agent:textInput', options),
  setAppearance: (mode) => ipcRenderer.invoke('agent:appearance', mode),
  manageFailed: (id, retry) =>
    ipcRenderer.invoke('agent:manageFailed', { id, retry }),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('agent:changed', listener)
    return () => ipcRenderer.removeListener('agent:changed', listener)
  },
})
