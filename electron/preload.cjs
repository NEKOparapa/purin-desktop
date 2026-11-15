const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wintermute', {
  initialAppearance:
    process.argv
      .find((arg) => arg.startsWith('--wintermute-appearance='))
      ?.split('=')[1] || 'system',
  state: () => ipcRenderer.invoke('agent:state'),
  schedule: (options) => ipcRenderer.invoke('agent:schedule', options),
  history: (options) => ipcRenderer.invoke('agent:history', options),
  compression: (options) => ipcRenderer.invoke('agent:compression', options),
  downloadHistoryFile: (file) =>
    ipcRenderer.invoke('agent:downloadHistoryFile', file),
  configure: (options) => ipcRenderer.invoke('agent:configure', options),
  send: (text) => ipcRenderer.invoke('agent:send', text),
  retry: (id) => ipcRenderer.invoke('agent:retry', id),
  setCollection: (enabled) => ipcRenderer.invoke('agent:collection', enabled),
  setScreenshots: (options) => ipcRenderer.invoke('agent:screenshots', options),
  setAppearance: (mode) => ipcRenderer.invoke('agent:appearance', mode),
  setBrowser: (enabled) => ipcRenderer.invoke('agent:browser', enabled),
  copyPairing: () => ipcRenderer.invoke('agent:copyPairing'),
  openExtension: () => ipcRenderer.invoke('agent:extensionFolder'),
  listShareWindows: () => ipcRenderer.invoke('agent:listShareWindows'),
  captureShareWindow: (id) =>
    ipcRenderer.invoke('agent:captureShareWindow', id),
  shareMaterial: (payload) =>
    ipcRenderer.invoke('agent:shareMaterial', payload),
  manageFailed: (id, retry) =>
    ipcRenderer.invoke('agent:manageFailed', { id, retry }),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('agent:changed', listener)
    return () => ipcRenderer.removeListener('agent:changed', listener)
  },
})
