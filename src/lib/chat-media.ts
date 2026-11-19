import type { ChatFileRef } from './desktop'

export const maxAttachments = 4

interface DraftImage {
  kind: 'image'
  id: string
  name: string
  url: string
}

export type DraftAttachment =
  | DraftImage
  | {
      kind: 'file'
      id: string
      name: string
      file: File
      uploaded?: ChatFileRef
    }

export async function prepareAttachment(file: File): Promise<DraftAttachment> {
  if (file.size > 32 * 1024 * 1024)
    throw new Error(file.name + ' 超过单个附件 32 MiB 的限制')
  if (
    !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)
  )
    return { kind: 'file', id: crypto.randomUUID(), name: file.name, file }
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('无法处理这张图片')
    let scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height))
    for (;;) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const url = canvas.toDataURL('image/jpeg', 0.88)
      if (!url.startsWith('data:image/jpeg;base64,'))
        throw new Error('图片转换失败')
      if (url.length <= 699071)
        return { kind: 'image', id: crypto.randomUUID(), name: file.name, url }
      scale *= 0.8
    }
  } finally {
    bitmap.close()
  }
}

// Chromium records WebM/Opus. Decode and resample to the mono PCM format used by ASR.
export async function speechWav(recording: Blob): Promise<ArrayBuffer> {
  const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(
    await recording.arrayBuffer(),
  )
  const samples = audio.getChannelData(0)
  if (!samples.length || samples.length > 120 * 16000)
    throw new Error('录音为空或超过两分钟')
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const tag = (offset: number, value: string) =>
    new Uint8Array(buffer, offset, value.length).set(
      new TextEncoder().encode(value),
    )
  tag(0, 'RIFF')
  view.setUint32(4, buffer.byteLength - 8, true)
  tag(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true)
  view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  tag(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(
      44 + 2 * i,
      Math.round(sample * (sample < 0 ? 32768 : 32767)),
      true,
    )
  }
  return buffer
}
