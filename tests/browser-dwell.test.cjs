const test = require('node:test')
const assert = require('node:assert/strict')
const drain = () => new Promise((resolve) => setImmediate(resolve))

function event() {
  return {
    addListener(fn) {
      this.fire = fn
    },
  }
}

function storage(data) {
  return {
    get: async () => ({ ...data }),
    set: async (changes) => Object.assign(data, changes),
    remove: async (key) => {
      delete data[key]
    },
  }
}

test('authorized visits are sent only on exit and survive a worker restart', async (t) => {
  const session = storage({})
  const tab = {
    id: 4,
    active: true,
    url: 'https://docs.example/meeting',
    title: '项目周会',
  }
  let focused = true
  let permitted = true
  const chrome = {
    storage: {
      local: storage({
        code: 'wm-browser-v1.12345.' + 'a'.repeat(43),
        sites: ['https://docs.example/*'],
      }),
      session,
    },
    windows: {
      WINDOW_ID_NONE: -1,
      getLastFocused: async () => ({ id: 1, focused, type: 'normal' }),
      onFocusChanged: event(),
    },
    tabs: {
      query: async () => [{ ...tab }],
      onActivated: event(),
      onUpdated: event(),
    },
    permissions: { contains: async () => permitted, onRemoved: event() },
    runtime: { onMessage: event(), onInstalled: event(), onStartup: event() },
    contextMenus: { onClicked: event() },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
  }
  const sent = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    sent.push(JSON.parse(options.body))
    return { ok: true }
  })
  global.chrome = chrome
  t.after(() => {
    delete global.chrome
  })
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 14) })
  await import('../browser-extension/worker.js')
  await chrome.tabs.onActivated.fire()
  const focus = async (on) => {
    focused = on
    await chrome.windows.onFocusChanged.fire(on ? 1 : -1)
  }
  t.mock.timers.tick(4999)
  await focus(false)
  assert.deepEqual(sent, [])
  await focus(true)
  t.mock.timers.tick(5000)
  await import('../browser-extension/worker.js?resume')
  await chrome.tabs.onActivated.fire()
  t.mock.timers.tick(30000)
  tab.title = '已更新的周会议程'
  await chrome.tabs.onActivated.fire()
  assert.deepEqual(sent, [])
  const leftAt = new Date().toISOString()
  Object.assign(tab, {
    id: 5,
    url: 'https://docs.example/task',
    title: '任务清单',
  })
  await chrome.tabs.onActivated.fire()
  assert.deepEqual(
    sent.map(({ kind, title, occurred_at }) => [kind, title, occurred_at]),
    [['page', '已更新的周会议程', leftAt]],
  )
  chrome.contextMenus.onClicked.fire(
    { menuItemId: 'selection', selectionText: '周五交付' },
    tab,
  )
  await drain()
  t.mock.timers.tick(5000)
  assert.deepEqual(
    sent.map((body) => body.kind),
    ['page', 'selection'],
  )
  await focus(false)
  await focus(false)
  assert.deepEqual(
    sent.map(({ kind, title }) => [kind, title]),
    [
      ['page', '已更新的周会议程'],
      ['selection', '任务清单'],
      ['page', '任务清单'],
    ],
  )

  await focus(true)
  t.mock.timers.tick(10000)
  permitted = false
  await chrome.permissions.onRemoved.fire({
    origins: ['https://docs.example/*'],
  })
  await focus(false)
  assert.equal(sent.length, 3)
  assert.equal((await session.get()).visit, undefined)
})
