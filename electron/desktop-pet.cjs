const { BrowserWindow, ipcMain, screen } = require('electron')
const path = require('node:path')
const { save } = require('./json-file.cjs')
const { readPosition, petAnchor, positionAt } = require('./pet-position.cjs')

function createDesktopPet(agent, getChatWindow, loadRenderer) {
  let pet, ready, displayId, enteredAt, lastSentId, historyReady, revision
  const earlierReplies = new Set()
  let session = 0
  let active = false
  let region, ignoringMouse
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
    if (process.platform !== 'darwin' || !region || !pet || pet.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const bounds = pet.getContentBounds()
    const x = cursor.x - bounds.x, y = cursor.y - bounds.y
    const ignore = !dragging && (x < region.x || x >= region.x + region.width ||
      y < region.y || y >= region.y + region.height)
    if (ignore === ignoringMouse) return
    ignoringMouse = ignore
    pet.setIgnoreMouseEvents(ignore, { forward: true })
  }

  function setRegion(x, y, width, height) {
    if (region?.x === x && region.y === y && region.width === width && region.height === height) return
    region = { x, y, width, height }
    if (process.platform === 'darwin') updateMouseTarget()
    else pet.setShape([region])
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
      workArea: { width: area.width, height: area.height }, anchor, preferredSide,
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
    // Only visible content accepts input. Keep its coordinate system stationary during a drag.
    const bounds = workArea()
    region = undefined
    ignoringMouse = undefined
    const current = ++session
    active = true
    try {
      if (!pet) {
        pet = new BrowserWindow({
          ...bounds, title: 'Wintermute 桌宠', show: false,
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
      } else pet.setBounds(bounds)
      const anchor = petAnchor(bounds, position)
      const left = Math.max(0, anchor.x - 52), top = Math.max(0, anchor.y - 40)
      setRegion(left, top, Math.min(bounds.width, anchor.x + 52) - left,
        Math.min(bounds.height, anchor.y + 40) - top)
      await ready
      if (!active || session !== current || chat.isDestroyed()) return
      publish(agent.state())
      pet.showInactive()
      chat.hide()
    } catch (error) {
      if (current === session) destroy()
      throw error
    }
  }

  const actions = {
    state: () => snapshot(agent.state()),
    setRegion({ x, y, width, height, session: requestSession }) {
      if (session !== requestSession || ![x, y, width, height].every(Number.isSafeInteger) ||
        x < 0 || y < 0 || width <= 0 || height <= 0) return
      setRegion(x, y, width, height)
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
      if (displayId !== display.id) {
        displayId = display.id
        pet.setBounds(area)
      }
      updateMouseTarget()
      pet.webContents.send('pet:position', {
        session, anchor: petAnchor(area, position), workArea: { width: area.width, height: area.height },
      })
    },
    drop(requestSession) {
      if (session === requestSession && finishDrag() === false) throw new Error('桌宠位置暂时无法保存。')
    },
    cursor(requestSession) {
      if (session === requestSession) updateMouseTarget()
    },
    send({ text, revision }) {
      const state = agent.state()
      if (revision !== state.connectionRevision) throw new Error('设备连接已更改')
      const id = agent.send({ text, revision })
      const previous = state.messages.findLast(m => m.role === 'assistant')
      if (previous) earlierReplies.add(previous.id)
      lastSentId = id
      publish(agent.state())
    },
    restore: settings => restore(settings === true),
  }
  for (const [name, action] of Object.entries(actions)) {
    ipcMain.handle('pet:' + name, (event, arg) => {
      if (!active || event.sender !== pet?.webContents || event.senderFrame !== event.sender.mainFrame)
        throw new Error('无效桌宠窗口')
      return action(arg)
    })
  }
  function updateDisplay() {
    if (!active) return
    bubbleKey = undefined
    pet.setBounds(workArea())
    updateMouseTarget()
    publish(agent.state())
  }
  screen.on('display-metrics-changed', updateDisplay)
  screen.on('display-removed', updateDisplay)
  return { enter, restore, publish, destroy }
}

module.exports = { createDesktopPet }
