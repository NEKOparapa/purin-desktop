const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const desktopWindowRoute = '/v1/perceptions/desktop-window'
const frameIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

function framePath(profile, id) {
  if (typeof id !== 'string' || !frameIdPattern.test(id))
    throw new Error('无效的代表帧文件名')
  return path.join(profile.mediaDirectory, 'periodic', id)
}

function removeMaterialFiles(p, item) {
  for (const frame of item.frames ?? [])
    fs.rmSync(framePath(p, frame.id), { force: true })
}

async function loadFrames(profile, frames, signal) {
  const result = []
  for (const frame of frames) {
    const bytes = await fs.promises.readFile(framePath(profile, frame.id), { signal })
    result.push({ occurred_at: frame.occurred_at,
      ...(frame.window_title && { window_title: frame.window_title }),
      jpeg_base64: bytes.toString('base64') })
  }
  signal.throwIfAborted()
  return result
}

async function submitWindow(p, item, request, signal) {
  const frames = item.frames
  const batches = []
  for (const frame of frames) {
    const last = batches.at(-1)
    if (!last || last.length >= 4 || last[0].segment !== frame.segment) batches.push([frame])
    else last.push(frame)
  }
  // Preserve distinct title segments even if the intervening title had no frames.
  const revisited = batches.some((part, i) => i && part[0].window_title === batches[i-1][0].window_title)
  let receipt
  if (frames.length <= 4 && !revisited) {
    receipt = await request(p, desktopWindowRoute,
      { ...item.body, frames: await loadFrames(p, frames, signal) }, signal)
  } else {
    const digest = createHash('sha256')
    for (const frame of frames) {
      const hash = frame.sha256 ?? createHash('sha256').update(
        await fs.promises.readFile(framePath(p, frame.id), { signal })).digest('hex')
      digest.update(frame.occurred_at + '\0' + (frame.window_title || '') + '\0' + hash + '\n')
    }
    const manifest = digest.digest('hex')
    let offset = 0
    for (const part of batches) {
      receipt = await request(p, desktopWindowRoute + '/batches', { ...item.body,
        manifest, offset, total_frames: frames.length, frames: await loadFrames(p, part, signal) }, signal)
      if (receipt?.event_id) break
      offset += part.length
      if (receipt?.next_offset !== offset) throw new Error('服务端未确认本批截图')
    }
  }
  if (typeof receipt?.event_id !== 'string' || !receipt.event_id)
    throw new Error('服务端未确认前台停留记录')
  return receipt
}

async function submitMaterial(p, item, request, uploadSignal) {
  const signal = AbortSignal.any([p.controller.signal, uploadSignal])
  if (item.kind !== 'perception' || item.body?.state_key !== 'desktop.window_span')
    throw new Error('无效的桌面停留记录')
  if (item.frames?.length) return submitWindow(p, item, request, signal)
  return request(p, '/v1/perceptions', item.body, signal)
}

module.exports = { submitMaterial, framePath, removeMaterialFiles, desktopWindowRoute }
