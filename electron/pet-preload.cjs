const { contextBridge, ipcRenderer } = require('electron')

// macOS forwards mouse movement while the transparent margins pass clicks through.
let shape, session, inside
if (process.platform === 'darwin') {
  window.addEventListener('mousemove', ({ clientX, clientY }) => {
    if (!shape) return
    const hit = shape.some(r => clientX >= r.x && clientX < r.x + r.width &&
      clientY >= r.y && clientY < r.y + r.height)
    if (inside === hit) return
    inside = hit
    void ipcRenderer.invoke('pet:cursor', session).catch(() => {})
  })
}

contextBridge.exposeInMainWorld('wintermutePet', {
  state: () => ipcRenderer.invoke('pet:state'),
  transcribe: (audio, connectionRevision) => ipcRenderer.invoke('pet:transcribe', { audio, connectionRevision }),
  move: (x, y, session) => ipcRenderer.invoke('pet:move', { x, y, session }),
  drop: session => ipcRenderer.invoke('pet:drop', session),
  uploadChatFile: (name, data, revision) => ipcRenderer.invoke('pet:uploadChatFile', { name, data, revision }),
  send: (text, revision, { images, documents, imageNames } = {}) =>
    ipcRenderer.invoke('pet:send', { text, revision, images, documents, imageNames }),
  setRegion: (bounds, nextShape, requestSession) => {
    shape = nextShape
    session = requestSession
    inside = undefined
    return ipcRenderer.invoke('pet:setRegion', { bounds, shape, session })
  },
  restore: (settings = false) => ipcRenderer.invoke('pet:restore', settings),
  subscribe(callback, onPosition) {
    const listener = (_event, state) => callback(state)
    const moved = (_event, position) => onPosition(position)
    ipcRenderer.on('pet:changed', listener)
    ipcRenderer.on('pet:position', moved)
    return () => {
      ipcRenderer.removeListener('pet:changed', listener)
      ipcRenderer.removeListener('pet:position', moved)
    }
  },
})
