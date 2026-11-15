import { pageInfo } from './protocol.js'

const el = (id) => document.getElementById(id)
const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
const page = pageInfo(tab)

async function render() {
  const {
    code,
    sites = [],
    pending = [],
    message,
  } = await chrome.storage.local.get(['code', 'sites', 'pending', 'message'])
  el('connection').textContent = code ? '已配对' : '未配对'
  el('page').textContent = page
    ? [page.title, page.domain].filter(Boolean).join(' · ')
    : '请选择普通网页'
  el('share').disabled = !page || !code
  el('site').disabled = !page || !code
  el('site').checked = sites.includes(page?.pattern)
  if (!code) el('settings').open = true
  el('queue').hidden = !pending.length
  el('count').textContent = pending.length + ' 条待发'
  el('message').textContent = message || ''
  el('sites').replaceChildren(
    ...sites.map((pattern) => {
      const li = document.createElement('li')
      const remove = document.createElement('button')
      remove.textContent = '停止'
      remove.onclick = () => act({ type: 'sites', pattern, enable: false })
      li.append(new URL(pattern).hostname, remove)
      return li
    }),
  )
}

async function act(action) {
  try {
    const result = await chrome.runtime.sendMessage(action)
    await render()
    if (!result?.ok) throw new Error(result?.error || '连接失败')
  } catch (error) {
    el('message').textContent = error.message
  }
}

el('pair').onsubmit = (event) => {
  event.preventDefault()
  const code = el('code').value
  el('code').value = ''
  act({ type: 'pair', code })
}
el('share').onclick = () => act({ type: 'share' })
el('retry').onclick = () => act({ type: 'retry' })
el('discard').onclick = () => act({ type: 'discard' })
el('site').onchange = async () => {
  const enable = el('site').checked
  try {
    if (
      enable &&
      !(await chrome.permissions.request({ origins: [page.pattern] }))
    )
      throw new Error('未授权此站点')
    await act({ type: 'sites', pattern: page.pattern, enable })
  } catch (e) {
    await render()
    el('message').textContent = e.message
  }
}
await render()
