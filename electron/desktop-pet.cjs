const { BrowserWindow, ipcMain, screen } = require('electron')
const path = require('node:path')
const { save } = require('./json-file.cjs')
const { readPosition, petAnchor, positionAt } = require('./pet-position.cjs')

function sameRect(a, b) {
  return a?.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function fits(rect, area) {
  return rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger) &&
    rect.width > 0 && rect.height > 0 && rect.x >= area.x && rect.y >= area.y &&
    rect.x + rect.width <= area.x + area.width && rect.y + rect.height <= area.y + area.height
}

function createDesktopPet(agent, getChatWindow, loadRenderer) {
  let pet, ready, displayId, enteredAt, lastSentId, historyReady, revision
  const earlierReplies = new Set()
  let session = 0
  let active = false
  let nativeBounds, shape, ignoringMouse
  let bubbleKey, preferredSide = 'right'
  const positionFile = path.join(agent.dir, 'pet-position.json')
  let position = readPosition(positionFile)
  let dragging = false

  function workArea() {
    const display = screen.getAllDisplays().find(item => item.id === displayId)
      ?? screen.getDisplayMatching(getChatWindow().getBounds())
    displayId = display.id
    return display.workArea
  }

  function finishDrag() {
    if (!dragging) return
    dragging = false
    updateMouseTarget()
    try {
      save(positionFile, position)
      return true
    } catch (error) {
      console.warn('Could not save the desktop pet position:', error.message)
      return false
    }
  }

  function updateMouseTarget() {
    if (process.platform !== 'darwin' || !shape || !pet || pet.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const bounds = pet.getContentBounds()
    const x = cursor.x - bounds.x, y = cursor.y - bounds.y
    const ignore = !dragging && !shape.some(r => x >= r.x && x < r.x + r.width &&
      y >= r.y && y < r.y + r.height)
    if (ignore === ignoringMouse) return
    ignoringMouse = ignore
    pet.setIgnoreMouseEvents(ignore, { forward: true })
  }

  function setRegion(bounds, nextShape, force = false) {
    const moved = force || !sameRect(nativeBounds, bounds)
    const resized = nativeBounds?.width !== bounds.width || nativeBounds?.height !== bounds.height
    const changed = shape?.length !== nextShape.length || nextShape.some((r, i) => !sameRect(shape[i], r))
    if (!moved && !changed) return
    if (moved) pet.setBounds(bounds)
    nativeBounds = bounds
    shape = nextShape
    if (process.platform === 'darwin') updateMouseTarget()
    else if (resized || changed || force) pet.setShape(shape)
  }

  function resetConversation(state) {
    revision = state.connectionRevision
    earlierReplies.clear()
    for (const message of state.messages)
      if (message.role === 'assistant') earlierReplies.add(message.id)
    historyReady = agent.profile.chat.loaded
    enteredAt = Date.now()
    lastSentId = undefined
    bubbleKey = undefined
  }

  function snapshot(state) {
    if (state.connectionRevision !== revision) resetConversation(state)
    const latest = state.messages.findLast(m => m.role === 'assistant')
    const sent = lastSentId && agent.profile.history.outbox.find(m => m.id === lastSentId)
    const failed = ['failed', 'unsent', 'missing', 'interrupted'].includes(sent?.status)
    // The first history page can arrive after the pet opens. Later replies are
    // recognized by server ID, independently of the server's clock.
    if (!historyReady && agent.profile.chat.loaded) {
      historyReady = true
      const sentIndex = state.messages.findIndex(m => m.id === lastSentId)
      state.messages.forEach((m, index) => {
        if (m.role === 'assistant' && !(sentIndex >= 0 && index > sentIndex) &&
          !(Date.parse(m.at) >= enteredAt)) earlierReplies.add(m.id)
      })
    }
    const fresh = latest && !earlierReplies.has(latest.id)
    const area = workArea()
    const anchor = petAnchor(area, position)
    const key = fresh ? latest.id : lastSentId
    if (key !== bubbleKey) {
      bubbleKey = key
      preferredSide = screen.getCursorScreenPoint().x > area.x + anchor.x ? 'left' : 'right'
    }
    return {
      session, appearance: state.appearance, configured: state.configured,
      workArea: area, anchor, preferredSide,
      connectionRevision: state.connectionRevision,
      awaitingReply: state.awaitingReply,
      replyReceivedAt: state.replyReceivedAt,
      reply: fresh ? { id: latest.id, text: latest.text } : null,
      waiting: ['queued', 'waiting'].includes(sent?.status),
      issue: failed ? sent.error || '消息处理失败，可回到主窗口重试。' : '',
    }
  }
  function publish(state) {
    if (active && pet && !pet.isDestroyed())
      pet.webContents.send('pet:changed', snapshot(state))
  }

  function restore(settings = false) {
    finishDrag()
    active = false
    pet?.hide()
    const chat = getChatWindow()
    if (!chat || chat.isDestroyed()) return
    if (chat.isMinimized()) chat.restore()
    chat.show()
    chat.focus()
    if (settings) chat.webContents.send('pet:open-settings')
  }

  function destroy() {
    finishDrag()
    active = false
    pet?.destroy()
  }

  async function enter() {
    const chat = getChatWindow()
    if (active || !chat || chat.isDestroyed()) return
    resetConversation(agent.state())
    displayId = position?.displayId ?? screen.getDisplayMatching(chat.getBounds()).id
    const area = workArea()
    const anchor = petAnchor(area, position)
    const left = Math.max(0, anchor.x - 52), top = Math.max(0, anchor.y - 40)
    const bounds = {
      x: area.x + left, y: area.y + top,
      width: Math.min(area.width, anchor.x + 52) - left,
      height: Math.min(area.height, anchor.y + 40) - top,
    }
    nativeBounds = undefined
    shape = undefined
    ignoringMouse = undefined
    const current = ++session
    active = true
    try {
      if (!pet) {
        pet = new BrowserWindow({
          ...bounds, title: 'Purin 桌宠', show: false,
          frame: false, transparent: true, backgroundColor: '#00000000',
          alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
          resizable: false, maximizable: false, fullscreenable: false,
          webPreferences: {
            preload: path.join(__dirname, 'pet-preload.cjs'),
            contextIsolation: true, sandbox: true, nodeIntegration: false,
          },
        })
        pet.setMenu(null)
        pet.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        pet.webContents.on('will-navigate', event => event.preventDefault())
        pet.webContents.on('render-process-gone', () => pet?.destroy())
        pet.on('closed', () => {
          pet = undefined
          if (active) restore()
        })
        ready = loadRenderer(pet)
      }
      setRegion(bounds, [{ x: 0, y: 0, width: bounds.width, height: bounds.height }])
      await ready
      if (!active || session !== current || chat.isDestroyed()) return
      publish(agent.state())
      // The Windows floating level follows the taskbar's Z order, which can drop
      // the pet behind the active application when the chat hides or the pet moves.
      if (process.platform === 'win32') pet.setAlwaysOnTop(true, 'pop-up-menu')
      pet.showInactive()
      chat.hide()
    } catch (error) {
      if (current === session) destroy()
      throw error
    }
  }

  const actions = {
    state: () => snapshot(agent.state()),
    transcribe: input => agent.transcribe(input),
    uploadChatFile: input => agent.uploadChatFile(input),
    setRegion({ bounds, shape, session: requestSession }) {
      if (session !== requestSession || !fits(bounds, workArea()) || !Array.isArray(shape) ||
        !shape.length || shape.length > 3 ||
        !shape.every(r => fits(r, { x: 0, y: 0, width: bounds.width, height: bounds.height }))) return
      setRegion(bounds, shape)
    },
    move({ x, y, session: requestSession }) {
      if (session !== requestSession || ![x, y].every(Number.isSafeInteger)) return
      const point = { x, y }
      const display = screen.getDisplayNearestPoint(point)
      const area = display.workArea
      const next = positionAt(display, point)
      if (dragging && displayId === display.id && position.x === next.x && position.y === next.y) return
      dragging = true
      position = next
      // A new monitor can use a different scale for the same window-local shape.
      if (displayId !== display.id) nativeBounds = undefined
      displayId = display.id
      pet.webContents.send('pet:position', {
        session, anchor: petAnchor(area, position), workArea: area,
      })
    },
    drop(requestSession) {
      if (session === requestSession && finishDrag() === false) throw new Error('桌宠位置暂时无法保存。')
    },
    cursor(requestSession) {
      if (session === requestSession) updateMouseTarget()
    },
    send({ text, revision, images, documents, imageNames }) {
      const state = agent.state()
      if (revision !== state.connectionRevision) throw new Error('设备连接已更改')
      const id = agent.send({ text, revision, images, documents, imageNames })
      const previous = state.messages.findLast(m => m.role === 'assistant')
      if (previous) earlierReplies.add(previous.id)
      lastSentId = id
      publish(agent.state())
    },
    restore: settings => restore(settings === true),
  }
  for (const [name, action] of Object.entries(actions)) {
    ipcMain.handle('pet:' + name, (event, arg) => {
      if (!isActiveContents(event.sender) || event.senderFrame !== event.sender.mainFrame) {
        // Stopping the recorder can resize the composer just as the pet is hidden.
        if (name === 'setRegion') return
        throw new Error('无效桌宠窗口')
      }
      return action(arg)
    })
  }
  function updateDisplay() {
    if (!active) return
    bubbleKey = undefined
    if (nativeBounds && fits(nativeBounds, workArea())) setRegion(nativeBounds, shape, true)
    publish(agent.state())
  }
  screen.on('display-metrics-changed', updateDisplay)
  screen.on('display-removed', updateDisplay)
  function isActiveContents(contents) {
    return active && pet && !pet.isDestroyed() && contents === pet.webContents
  }
  return { enter, restore, publish, destroy, isActiveContents }
}

module.exports = { createDesktopPet }
