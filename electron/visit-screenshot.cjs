const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { framePath } = require('./materials.cjs')

const screenshotDwellMs = 10 * 60 * 1000
const maxQueueBytes = 128 * 1024 * 1024

function saveVisitScreenshot(profile, jpegBase64, occurredAt, title) {
  const data = Buffer.from(jpegBase64, 'base64')
  if (data.length > 4 * 1024 * 1024 || data[0] !== 0xff || data[1] !== 0xd8)
    throw new Error('截图格式或大小无效')
  let used = data.length
  for (const item of profile.history.materials)
    for (const frame of item.frames || []) used += frame.bytes
  if (used > maxQueueBytes) throw new Error('截图队列已达 128 MiB，无法保存本次截图')
  const id = randomUUID()
  const file = framePath(profile, id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data, { flag: 'wx', mode: 0o600 })
  return { id, occurred_at: occurredAt, bytes: data.length, ...(title && { window_title: title }) }
}

module.exports = { screenshotDwellMs, saveVisitScreenshot }
