const { contextBridge, ipcRenderer } = require('electron')

// macOS forwards mouse movement while the transparent margins pass clicks through.
let region, session, inside
if (process.platform === 'darwin') {
  window.addEventListener('mousemove', ({ clientX, clientY }) => {
    if (!region) return
    const hit = clientX >= region.x && clientX < region.x + region.width &&
      clientY >= region.y && clientY < region.y + region.height
    if (inside === hit) return
    inside = hit
    void ipcRenderer.invoke('pet:cursor', session).catch(() => {})
  })
}

contextBridge.exposeInMainWorld('wintermutePet', {
  state: () => ipcRenderer.invoke('pet:state'),
  move: (x, y, session) => ipcRenderer.invoke('pet:move', { x, y, session }),
  drop: session => ipcRenderer.invoke('pet:drop', session),
  send: (text, revision) => ipcRenderer.invoke('pet:send', { text, revision }),
  setRegion: (next, requestSession) => {
    region = next
    session = requestSession
    inside = undefined
    return ipcRenderer.invoke('pet:setRegion', { ...next, session })
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
