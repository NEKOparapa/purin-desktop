const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const routes = {
  slice: '/v1/slices',
  perception: '/v1/perceptions',
  image: '/v1/image/slices',
  audio: '/v1/audio/slices',
}

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
  if (!item.body) fs.rmSync(mediaPath(p, item), { force: true })
}

function recordedTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new Error('材料缺少有效的采集时间')
  return new Date(value).toISOString()
}

function sliceBody(text, at, id = randomUUID()) {
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    Buffer.byteLength(text) > 48000
  )
    throw new Error('文字应在 1 至 48000 字节之间')
  return { event_id: id, occurred_at: recordedTime(at), text: text.trim() }
}

function prepareShare(material, directory) {
  const id = randomUUID()
  const at = recordedTime(material.occurredAt)
  if (material.kind === 'text') {
    if (typeof material.text !== 'string' || !material.text.trim())
      throw new Error('请输入分享内容')
    return {
      id,
      kind: 'slice',
      label: '主动分享的文字',
      body: sliceBody('主动分享的文字\n' + material.text, at, id),
    }
  }
  const image = material.kind === 'image'
  if (!image && material.kind !== 'audio') throw new Error('未知的分享类型')
  const encoded = image ? material.jpegBase64 : material.oggBase64
  if (
    typeof encoded !== 'string' ||
    !encoded.length ||
    encoded.length > 5592408
  )
    throw new Error('单份材料上限为 4 MiB')
  const data = Buffer.from(encoded, 'base64')
  if (
    !data.length ||
    data.length > 4194304 ||
    (image
      ? data[0] !== 0xff || data[1] !== 0xd8
      : data.toString('ascii', 0, 4) !== 'OggS' ||
        !Number.isInteger(material.samples) ||
        material.samples < 1 ||
        material.samples > 4800000)
  )
    throw new Error('分享文件格式无效')
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, id), data, { flag: 'wx', mode: 0o600 })
  return {
    id,
    at,
    kind: material.kind,
    label: image ? '主动分享的截图' : '主动分享的录音',
    ...(image ? {} : { samples: material.samples }),
  }
}

function mediaPath(p, item) {
  return path.join(
    p.mediaDirectory,
    item.source === 'screenshot' ? 'periodic' : '',
    item.id,
  )
}

async function submitMaterial(p, item, request, uploadSignal) {
  const signal = AbortSignal.any([p.controller.signal, uploadSignal])
  if (item.source === 'screenshot')
    throw new Error('旧版自动截图缺少对应的前台停留，无法投递')
  if (item.kind === 'perception' && item.body.state_key === 'desktop.window_span' && item.frames?.length) {
    const frames = []
    for (const frame of item.frames) {
      const bytes = await fs.promises.readFile(framePath(p, frame.id), { signal })
      frames.push({
        occurred_at: frame.occurred_at,
        ...(frame.window_title && { window_title: frame.window_title }),
        jpeg_base64: bytes.toString('base64'),
      })
    }
    signal.throwIfAborted()
    const receipt = await request(p, desktopWindowRoute, { ...item.body, frames }, signal)
    if (typeof receipt?.event_id !== 'string' || !receipt.event_id)
      throw new Error('服务端未确认前台停留记录')
    return receipt
  }
  const route = routes[item.kind]
  if (item.body) return request(p, route, item.body, signal)
  const data = await fs.promises.readFile(mediaPath(p, item))
  const headers =
    item.kind === 'image'
      ? {
          'Content-Type': 'image/jpeg',
          'X-Event-ID': item.id,
          'X-Occurred-At': item.at,
        }
      : {
          'Content-Type': 'audio/ogg',
          'X-Recording-ID': item.id,
          'X-Segment-Sequence': '1',
          'X-Start-Sample': '0',
          'X-Sample-Rate': '16000',
          'X-Sample-Count': String(item.samples),
          'X-Recording-Elapsed-Samples': String(
            Math.max(
              item.samples,
              Math.round((Date.now() - Date.parse(item.at)) * 16),
            ),
          ),
        }
  return request(p, route, data, signal, headers)
}

module.exports = { prepareShare, sliceBody, submitMaterial, mediaPath, framePath, removeMaterialFiles, desktopWindowRoute }
