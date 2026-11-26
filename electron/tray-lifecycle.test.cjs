const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { DesktopAgent } = require('./agent.cjs')
const { createWindowLifecycle } = require('./tray-lifecycle.cjs')

test('tray menu exposes 显示界面 and 退出应用, and window close honors closeAction', () => {
  let closeAction = 'tray'
  let hidden = 0
  let restored = 0
  let created = 0
  let quits = 0
  let win = {
    isDestroyed: () => false,
    hide: () => {
      hidden++
    },
  }
  const lifecycle = createWindowLifecycle({
    getCloseAction: () => closeAction,
    getWindow: () => win,
    createWindow: () => {
      created++
    },
    restorePet: () => {
      restored++
    },
    quit: () => {
      quits++
    },
    platform: 'win32',
  })

  const menu = lifecycle.trayMenuTemplate()
  assert.deepEqual(
    menu.map((item) => item.label),
    ['显示界面', '退出应用'],
  )

  let prevented = false
  lifecycle.handleWindowClose({
    preventDefault() {
      prevented = true
    },
  })
  assert.equal(prevented, true)
  assert.equal(hidden, 1)
  assert.equal(lifecycle.isQuitting(), false)

  menu[0].click()
  assert.equal(restored, 1)
  assert.equal(created, 0)

  win = null
  menu[0].click()
  assert.equal(created, 1)

  win = {
    isDestroyed: () => false,
    hide: () => {
      hidden++
    },
  }
  closeAction = 'quit'
  prevented = false
  lifecycle.handleWindowClose({
    preventDefault() {
      prevented = true
    },
  })
  assert.equal(prevented, false)
  assert.equal(hidden, 1)
  assert.equal(lifecycle.isQuitting(), true)

  const trayExitLifecycle = createWindowLifecycle({
    getCloseAction: () => 'tray',
    getWindow: () => win,
    createWindow: () => {},
    restorePet: () => {},
    quit: () => {
      quits++
    },
    platform: 'win32',
  })
  trayExitLifecycle.trayMenuTemplate()[1].click()
  assert.equal(quits, 1)
  assert.equal(trayExitLifecycle.isQuitting(), true)
  let preventedOnQuit = false
  trayExitLifecycle.handleWindowClose({
    preventDefault() {
      preventedOnQuit = true
    },
  })
  assert.equal(preventedOnQuit, false)
})

test('DesktopAgent persists closeAction preference and defaults to tray', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purin-close-action-'))
  const secure = {
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => b.toString('utf8'),
  }
  const updates = []
  let agent
  try {
    agent = new DesktopAgent(
      dir,
      secure,
      async () => null,
      (state) => updates.push(state),
      null,
      null,
      async () => null,
    )
    assert.equal(agent.state().closeAction, 'tray')
    assert.throws(() => agent.setCloseAction('invalid'), /无效的关闭按钮选项/)

    agent.setCloseAction('quit')
    assert.equal(agent.state().closeAction, 'quit')
    assert.equal(updates.at(-1)?.closeAction, 'quit')
    agent.close()

    agent = new DesktopAgent(
      dir,
      secure,
      async () => null,
      () => {},
      null,
      null,
      async () => null,
    )
    assert.equal(agent.state().closeAction, 'quit')
    agent.setCloseAction('tray')
    assert.equal(agent.state().closeAction, 'tray')
  } finally {
    agent?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
