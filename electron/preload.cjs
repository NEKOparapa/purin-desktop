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
  memorySchedule: (options) => ipcRenderer.invoke('agent:memorySchedule', options),
  memoryFile: (path) => ipcRenderer.invoke('agent:memoryFile', path),
  recordItems: (options) => ipcRenderer.invoke('agent:recordItems', options),
  recordContent: (options) => ipcRenderer.invoke('agent:recordContent', options),
  apiKeys: () => ipcRenderer.invoke('agent:apiKeys'),
  updateApiKey: (options) => ipcRenderer.invoke('agent:updateApiKey', options),
  connectors: () => ipcRenderer.invoke('agent:connectors'),
  connectorHistory: (cursor) => ipcRenderer.invoke('agent:connectorHistory', cursor),
  chooseObsidianVault: () => ipcRenderer.invoke('agent:chooseObsidianVault'),
  setObsidianConnector: (options) => ipcRenderer.invoke('agent:setObsidianConnector', options),
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
  history: (options) => ipcRenderer.invoke('agent:history', options),
  terminalToolHistory: (cursor) => ipcRenderer.invoke('agent:terminalToolHistory', cursor),
  previewHistoryImage: (options) => ipcRenderer.invoke('agent:previewHistoryImage', options),
  compression: (options) => ipcRenderer.invoke('agent:compression', options),
  downloadHistoryFile: (file) =>
    ipcRenderer.invoke('agent:downloadHistoryFile', file),
  configure: (options) => ipcRenderer.invoke('agent:configure', options),
  uploadChatFile: (name, data, revision) => ipcRenderer.invoke('agent:uploadChatFile', { name, data, revision }),
  send: (text, images, documents, imageNames, revision) => ipcRenderer.invoke('agent:send', { text, images, documents, imageNames, revision }),
  transcribe: (audio, connectionRevision) => ipcRenderer.invoke('agent:transcribe', { audio, connectionRevision }),
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
