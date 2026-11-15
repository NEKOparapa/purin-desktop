const { open, rename, rm } = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { pipeline } = require('node:stream/promises')

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

module.exports = { saveHistoryFile }
