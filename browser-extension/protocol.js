export function parseCode(code) {
  const match = /^wm-browser-v1\.([1-9]\d{0,4})\.([a-zA-Z0-9_-]{43})$/.exec(
    code ?? '',
  )
  if (!match || Number(match[1]) > 65535)
    throw new Error('请粘贴桌面设置中的浏览器配对码')
  return { url: 'http://127.0.0.1:' + match[1], token: match[2] }
}

export function pageInfo(tab) {
  if (!tab || tab.incognito || !tab.url) return null
  const url = new URL(tab.url)
  if (!['http:', 'https:'].includes(url.protocol)) return null
  // Some untitled pages display the full URL as their title.
  const title = (tab.title || '')
    .replace(/https?:\/\/[^\s]+/gi, (raw) => {
      try {
        return new URL(raw).hostname
      } catch {
        return ''
      }
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512)
  return {
    domain: url.hostname,
    title,
    pattern: url.protocol + '//' + url.hostname + '/*',
  }
}

export async function deliver(code, route, body) {
  const { url, token } = parseCode(code)
  let response
  try {
    response = await fetch(url + route, {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    throw new Error('桌面端未连接，请检查浏览器接入开关')
  }
  if (!response.ok) {
    if ([401, 403].includes(response.status))
      throw new Error('配对失效，请重新粘贴桌面配对码')
    throw new Error('桌面端未接收（' + response.status + '）')
  }
}
