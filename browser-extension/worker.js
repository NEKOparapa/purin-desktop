import { deliver, pageInfo } from './protocol.js'

const storage = chrome.storage.local
const session = chrome.storage.session
let serial = Promise.resolve()
function ordered(operation) {
  const next = serial.then(operation)
  serial = next.catch(() => {})
  return next
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'selection',
      title: '将选中文字分享到 Wintermute',
      contexts: ['selection'],
      documentUrlPatterns: ['https://*/*', 'http://*/*'],
    })
  })
})

async function status(message, failed = false) {
  await storage.set({ message })
  await chrome.action.setBadgeBackgroundColor({
    color: failed ? '#81504b' : '#446d64',
  })
  await chrome.action.setBadgeText({ text: failed ? '!' : '✓' })
}

function capture(kind, page, at = Date.now()) {
  return {
    kind,
    domain: page.domain,
    title: page.title,
    occurred_at: new Date(at).toISOString(),
    event_id: crypto.randomUUID(),
  }
}

async function flushManual(code) {
  const { pending = [] } = await storage.get('pending')
  while (pending.length) {
    await deliver(code, '/capture', pending[0])
    pending.shift()
    await storage.set({ pending })
  }
  await status('桌面端已接收')
}

async function share(tab, selection) {
  const page = pageInfo(tab)
  if (!page) throw new Error('请选择普通网页')
  const { code, pending = [] } = await storage.get(['code', 'pending'])
  if (!code) throw new Error('请先连接桌面端')
  if (pending.length >= 20) throw new Error('本机待发队列已满，请先重试或清空')
  const event = capture(
    selection === undefined ? 'shared-page' : 'selection',
    page,
  )
  if (selection !== undefined) {
    if (!selection?.trim() || selection.length > 8000)
      throw new Error('请选中 1 至 8000 个字符')
    event.selection = selection.trim()
  }
  await storage.set({ pending: [...pending, event] })
  await flushManual(code)
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'selection') {
    // A selection inside a subframe belongs to that frame's site.
    const inFrame = info.frameId > 0 && info.frameUrl
    const target = inFrame
      ? { ...tab, url: info.frameUrl, title: '' }
      : { ...tab, url: info.pageUrl || tab?.url }
    ordered(() => share(target, info.selectionText ?? '')).catch((e) =>
      status(e.message, true),
    )
  }
})

async function foregroundPage() {
  const { code, sites = [] } = await storage.get(['code', 'sites'])
  if (!code || !sites.length) return null
  const window = await chrome.windows.getLastFocused()
  const [tab] =
    window.focused && window.type === 'normal'
      ? await chrome.tabs.query({ active: true, windowId: window.id })
      : []
  const page = pageInfo(tab)
  if (
    !page ||
    !sites.includes(page.pattern) ||
    !(await chrome.permissions.contains({ origins: [page.pattern] }))
  )
    return null
  // Compare navigations across worker suspension without keeping a raw URL in storage.
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(tab.url),
  )
  const pageKey = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  return { code, page, tabId: tab.id, pageKey }
}

const minimumPageDwellMs = 5_000
async function observe(current, at) {
  const { visit } = await session.get('visit')
  if (
    visit &&
    current &&
    at >= visit.startedAt &&
    current.tabId === visit.tabId &&
    current.pageKey === visit.pageKey &&
    current.code === visit.code
  ) {
    if (current.page.title !== visit.page.title)
      await session.set({ visit: { ...current, startedAt: visit.startedAt } })
    return
  }
  if (current) await session.set({ visit: { ...current, startedAt: at } })
  else if (visit) await session.remove('visit')
  if (!visit || at - visit.startedAt < minimumPageDwellMs) return
  const { code, sites = [] } = await storage.get(['code', 'sites'])
  if (
    code === visit.code &&
    sites.includes(visit.page.pattern) &&
    (await chrome.permissions.contains({ origins: [visit.page.pattern] }))
  )
    await deliver(code, '/capture', capture('page', visit.page, at))
}

let revision = 0
function schedule(unfocused = false) {
  const change = ++revision
  const at = Date.now()
  // Start reading at the focus event, even if the preceding upload is still running.
  // A blur is authoritative; a tab query overtaken by a later focus event is stale.
  const snapshot = (unfocused ? Promise.resolve(null) : foregroundPage()).then(
    (page) => ({ page, stale: !unfocused && change !== revision }),
    (error) => ({ error }),
  )
  return ordered(async () => {
    const result = await snapshot
    if (result.error) throw result.error
    if (!result.stale) await observe(result.page, at)
  }).catch((e) => status(e.message, true))
}
chrome.tabs.onActivated.addListener(() => schedule())
chrome.tabs.onUpdated.addListener((_id, changes, tab) => {
  if (
    tab.active &&
    (changes.title !== undefined ||
      changes.url ||
      changes.status === 'complete')
  )
    schedule()
})
chrome.windows.onFocusChanged.addListener((windowId) =>
  schedule(windowId === chrome.windows.WINDOW_ID_NONE),
)
chrome.permissions.onRemoved.addListener(({ origins = [] }) => {
  ordered(async () => {
    const { visit } = await session.get('visit')
    if (visit && origins.includes(visit.page.pattern))
      await session.remove('visit')
  })
  return schedule()
})
chrome.runtime.onStartup.addListener(() => schedule())
void schedule()

chrome.runtime.onMessage.addListener((action, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab ||
    sender.url !== chrome.runtime.getURL('popup.html')
  )
    return false
  ordered(async () => {
    if (action.type === 'pair') {
      const code = action.code.trim()
      await deliver(code, '/check', {})
      const existing = await storage.get(['code', 'pending', 'sites'])
      if (existing.code !== code) {
        if (existing.pending?.length)
          throw new Error('请先重试或清空旧配对的待发分享，再更换配对码')
        const optional = (existing.sites || []).filter(
          (site) => site !== 'http://127.0.0.1/*',
        )
        if (optional.length)
          await chrome.permissions.remove({ origins: optional })
        await storage.set({ pending: [], sites: [] })
        await session.remove('visit')
      }
      await storage.set({ code })
      await status('与桌面端连接成功')
    } else if (action.type === 'share') {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      })
      await share(tab)
    } else if (action.type === 'retry') {
      const { code } = await storage.get('code')
      await flushManual(code)
    } else if (action.type === 'sites') {
      const { sites = [], code } = await storage.get(['sites', 'code'])
      if (!code) throw new Error('请先连接桌面端')
      const next = new Set(sites)
      if (action.enable) {
        const [tab] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        })
        if (
          pageInfo(tab)?.pattern !== action.pattern ||
          !(await chrome.permissions.contains({ origins: [action.pattern] }))
        )
          throw new Error('站点尚未授权')
        next.add(action.pattern)
      } else {
        next.delete(action.pattern)
        if (action.pattern !== 'http://127.0.0.1/*')
          await chrome.permissions.remove({ origins: [action.pattern] })
      }
      await storage.set({ sites: [...next] })
      schedule()
    } else if (action.type === 'discard') {
      await storage.set({ pending: [] })
      await status('已清空待发分享')
    } else throw new Error('未知操作')
  }).then(
    () => reply({ ok: true }),
    async (e) => {
      await status(e.message, true)
      reply({ ok: false, error: e.message })
    },
  )
  return true
})
