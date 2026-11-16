const { open, rename, rm } = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { pipeline } = require('node:stream/promises')

const imageLimit = 4 * 1024 * 1024

async function readHistoryImage(response) {
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/jpeg' ||
      Number(response.headers.get('content-length')) > imageLimit) {
    await response.body?.cancel()
    throw new Error('附件不是可预览的 JPEG 截图，或超过 4 MiB')
  }
  if (!response.body) throw new Error('截图内容为空')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > imageLimit) throw new Error('截图超过 4 MiB')
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
    throw new Error('截图文件格式无效')
  return bytes.buffer
}

function suggestedName(name) {
  if (typeof name !== 'string') throw new Error('无效的附件名')
  const base = path.win32
    .basename(name)
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
    .replace(/[ .]+$/gu, '')
  if (!base) return '附件'
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(base)
    ? '_' + base
    : base
}

async function saveHistoryFile({ id, name }, choosePath, getFile) {
  if (typeof id !== 'string' || !/^[\w:-]{1,256}$/.test(id))
    throw new Error('无效的附件')
  const destination = await choosePath(suggestedName(name))
  if (!destination) return { saved: false }
  // Stage beside the destination so an interrupted download leaves an existing file intact.
  const staging = path.join(
    path.dirname(destination),
    '.wintermute-' + randomUUID() + '.part',
  )
  const handle = await open(staging, 'wx', 0o600)
  try {
    const response = await getFile(id)
    if (!response.body) throw new Error('附件内容为空')
    await pipeline(response.body, handle.createWriteStream())
    await rename(staging, destination)
    return { saved: true }
  } finally {
    await handle.close()
    await rm(staging, { force: true })
  }
}

module.exports = { saveHistoryFile, readHistoryImage }
