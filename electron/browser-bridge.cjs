const http = require('node:http')
const { randomBytes, timingSafeEqual } = require('node:crypto')

// The manifest's public key keeps the unpacked extension ID stable across installs.
const EXTENSION_ORIGIN = 'chrome-extension://eglbccbkkdgfkokcificnicgigmehpbb'
const CODE = /^wm-browser-v1\.([1-9]\d{0,4})\.([A-Za-z0-9_-]{43})$/
const LIMIT = 48 * 1024

function parseCapture(body) {
  if (
    !body ||
    !['page', 'shared-page', 'selection'].includes(body.kind) ||
    typeof body.event_id !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.event_id) ||
    typeof body.occurred_at !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(body.occurred_at) ||
    !Number.isFinite(Date.parse(body.occurred_at)) ||
    typeof body.domain !== 'string' ||
    !body.domain ||
    body.domain.length > 253 ||
    !/^(?:[a-z\d.-]+|\[[a-f\d:]+\])$/i.test(body.domain) ||
    typeof body.title !== 'string' ||
    body.title.length > 512
  )
    throw new Error('invalid capture')
  const title = body.title.replace(/\s+/g, ' ').trim()
  const value = { domain: body.domain.toLowerCase(), title }
  const event = {
    kind: body.kind,
    value,
    event_id: body.event_id,
    occurred_at: body.occurred_at,
  }
  if (body.kind === 'page') return event
  const page = title ? `《${title}》 · ${value.domain}` : value.domain
  if (body.kind === 'shared-page')
    return { ...event, text: `分享的网页：${page}` }
  if (
    typeof body.selection !== 'string' ||
    !body.selection.trim() ||
    body.selection.length > 8000
  ) {
    throw new Error('invalid selection')
  }
  return { ...event, text: `网页选区 · ${page}\n${body.selection.trim()}` }
}

class BrowserBridge {
  constructor({ onCapture }) {
    this.onCapture = onCapture
    this.server = null
    this.code = ''
  }

  async start(savedCode) {
    if (this.starting) return this.starting
    if (this.server?.listening) return this.code
    this.starting = this.listen(savedCode)
    try {
      return await this.starting
    } finally {
      this.starting = null
    }
  }

  async listen(savedCode) {
    const saved = savedCode ? CODE.exec(savedCode) : null
    if (savedCode && (!saved || Number(saved[1]) > 65535))
      throw new Error('浏览器配对码无效')
    const token = saved ? saved[2] : randomBytes(32).toString('base64url')
    const authorization = Buffer.from('Bearer ' + token)
    const server = http.createServer(
      { requestTimeout: 8000, headersTimeout: 8000 },
      async (req, res) => {
        const reply = (status) => {
          res.writeHead(status, { 'Cache-Control': 'no-store' })
          res.end()
        }
        if (
          this.server !== server ||
          !server.listening ||
          req.headers.host !== '127.0.0.1:' + server.address().port ||
          req.headers.origin !== EXTENSION_ORIGIN
        )
          return reply(403)
        res.setHeader('Access-Control-Allow-Origin', EXTENSION_ORIGIN)
        if (req.url !== '/check' && req.url !== '/capture') return reply(404)
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'POST')
          res.setHeader(
            'Access-Control-Allow-Headers',
            'Authorization, Content-Type',
          )
          res.setHeader('Access-Control-Allow-Private-Network', 'true')
          return reply(204)
        }
        if (req.method !== 'POST') return reply(405)
        const actual = Buffer.from(req.headers.authorization || '')
        if (
          actual.length !== authorization.length ||
          !timingSafeEqual(actual, authorization)
        )
          return reply(401)
        if (req.url === '/check') return reply(204)
        if (req.headers['content-type'] !== 'application/json')
          return reply(415)
        let body
        try {
          const chunks = []
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > LIMIT) return reply(413)
            chunks.push(chunk)
          }
          body = parseCapture(
            JSON.parse(Buffer.concat(chunks).toString('utf8')),
          )
        } catch {
          return reply(400)
        }
        if (this.server !== server || !server.listening) return reply(503)
        try {
          await this.onCapture(body)
          reply(202)
        } catch {
          reply(503)
        }
      },
    )
    this.server = server
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(saved ? Number(saved[1]) : 0, '127.0.0.1', resolve)
      })
      if (this.server !== server) throw new Error('浏览器连接已关闭')
      this.code = `wm-browser-v1.${server.address().port}.${token}`
      return this.code
    } catch (error) {
      if (this.server === server) this.server = null
      throw error
    }
  }

  async stop() {
    const server = this.server
    this.server = null
    this.code = ''
    if (!server) return
    if (this.starting) await this.starting.catch(() => {})
    await new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    })
  }
}

module.exports = { BrowserBridge }
