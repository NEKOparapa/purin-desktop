const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash, randomUUID } = require('node:crypto')
const { BrowserBridge } = require('../electron/browser-bridge.cjs')
const manifest = require('../browser-extension/manifest.json')
const id = createHash('sha256')
  .update(Buffer.from(manifest.key, 'base64'))
  .digest('hex')
  .slice(0, 32)
  .replace(/./g, (hex) => String.fromCharCode(97 + parseInt(hex, 16)))

test('extension bridge authenticates the local extension and passes a short meeting selection', async (t) => {
  const received = []
  const bridge = new BrowserBridge({
    onCapture: async (event) => received.push(event),
  })
  const { parseCode, pageInfo } =
    await import('../browser-extension/protocol.js')
  const code = await bridge.start()
  t.after(() => bridge.stop())
  const { url, token } = parseCode(code)
  const headers = {
    'Content-Type': 'application/json',
    Origin: 'chrome-extension://' + id,
    Authorization: 'Bearer ' + token,
  }
  const page = pageInfo({
    url: 'https://docs.example/notes?secret=x#person',
    title: '会议纪要',
  })
  assert.deepEqual(page, {
    domain: 'docs.example',
    pattern: 'https://docs.example/*',
    title: '会议纪要',
  })
  assert.equal(pageInfo({ url: 'chrome://flags' }), null)
  assert.equal(pageInfo({ url: 'https://docs.example', incognito: true }), null)
  assert.equal(
    pageInfo({
      url: 'https://docs.example/?token=123',
      title: 'https://docs.example/?token=123',
    }).title,
    'docs.example',
  )
  const body = {
    kind: 'selection',
    event_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    title: page.title,
    domain: page.domain,
    selection: '演示改到周五。',
  }
  const post = (route, data, override = {}) =>
    fetch(url + route, {
      method: 'POST',
      headers: { ...headers, ...override },
      body: JSON.stringify(data),
    })
  assert.equal(
    (await post('/check', {}, { Origin: 'https://docs.example' })).status,
    403,
  )
  assert.equal(
    (await post('/check', {}, { Authorization: 'Bearer wrong' })).status,
    401,
  )
  assert.equal(
    (await post('/capture', { ...body, domain: 'docs.example/?token=bad' }))
      .status,
    400,
  )
  assert.equal(
    (await post('/capture', { ...body, selection: 'a'.repeat(8001) })).status,
    400,
  )
  assert.equal((await post('/capture', body)).status, 202)
  assert.deepEqual(received, [
    {
      kind: body.kind,
      event_id: body.event_id,
      occurred_at: body.occurred_at,
      value: { domain: page.domain, title: page.title },
      text: '网页选区 · 《会议纪要》 · docs.example\n演示改到周五。',
    },
  ])
  await bridge.stop()
  await assert.rejects(post('/check', {}))
  assert.equal(await bridge.start(code), code)
  assert.equal((await post('/capture', { ...body, kind: 'page' })).status, 202)
  assert.equal(received[1].kind, 'page')
  bridge.onCapture = async () => {
    throw new Error('profile closed')
  }
  assert.equal((await post('/capture', body)).status, 503)
})
