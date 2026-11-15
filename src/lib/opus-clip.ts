// Wintermute's audio endpoint expects complete Ogg/Opus pages and a mono
// 16 kHz sample count. Chromium's microphone recorder produces WebM.
const RATE = 16000
const OPUS_CLOCK = 48000
export const MAX_RECORDING_SECONDS = 300

const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let value = i << 24
  for (let bit = 0; bit < 8; bit++)
    value = (value << 1) ^ (value < 0 ? 0x04c11db7 : 0)
  return value
})

function oggPage(
  packets: Uint8Array[],
  flags: number,
  granule: number,
  serial: number,
  sequence: number,
) {
  const lacing: number[] = []
  let bodySize = 0
  for (const packet of packets) {
    let remaining = packet.length
    bodySize += remaining
    while (remaining >= 255) {
      lacing.push(255)
      remaining -= 255
    }
    lacing.push(remaining)
  }
  if (lacing.length > 255) throw new Error('录音分页超过上限')
  const page = new Uint8Array(27 + lacing.length + bodySize)
  const view = new DataView(page.buffer)
  page.set([79, 103, 103, 83, 0, flags])
  view.setUint32(6, granule, true)
  view.setUint32(14, serial, true)
  view.setUint32(18, sequence, true)
  page[26] = lacing.length
  page.set(lacing, 27)
  let offset = 27 + lacing.length
  for (const packet of packets) {
    page.set(packet, offset)
    offset += packet.length
  }
  let crc = 0
  for (const byte of page) crc = (crc << 8) ^ crcTable[(crc >>> 24) ^ byte]
  view.setUint32(22, crc, true)
  return page
}

export async function encodeRecording(blob: Blob) {
  const config: AudioEncoderConfig = {
    codec: 'opus',
    numberOfChannels: 1,
    sampleRate: OPUS_CLOCK,
    bitrate: 24000,
    opus: { frameDuration: 20000 },
  }
  if (
    typeof AudioEncoder === 'undefined' ||
    !(await AudioEncoder.isConfigSupported(config)).supported
  )
    throw new Error('当前桌面运行环境尚不支持 Opus 录音')
  const decoded = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(
    await blob.arrayBuffer(),
  )
  const samples = Math.min(decoded.length, MAX_RECORDING_SECONDS * RATE)
  if (!samples) throw new Error('没有录到声音片段')
  // Resample the 16 kHz recording to the Opus clock before encoding so the
  // encoder's pre-skip and the final Ogg granule are in the same units.
  const mix = new OfflineAudioContext(1, samples * 3, OPUS_CLOCK)
  const input = mix.createBufferSource()
  input.buffer = decoded
  input.connect(mix.destination)
  input.start()
  const pcm = (await mix.startRendering()).getChannelData(0)
  const packets: Uint8Array[] = []
  let idHeader: Uint8Array<ArrayBuffer> | undefined
  let failure: DOMException | undefined
  const encoder = new AudioEncoder({
    output(chunk, meta) {
      if (meta?.decoderConfig?.description) {
        const header = meta.decoderConfig.description
        idHeader = ArrayBuffer.isView(header)
          ? new Uint8Array(
              header.buffer,
              header.byteOffset,
              header.byteLength,
            ).slice()
          : new Uint8Array(header).slice()
      }
      const bytes = new Uint8Array(chunk.byteLength)
      chunk.copyTo(bytes)
      packets.push(bytes)
    },
    error(error) {
      failure = error
    },
  })
  try {
    encoder.configure(config)
    for (let offset = 0; offset < pcm.length; offset += OPUS_CLOCK) {
      const data = pcm.subarray(offset, offset + OPUS_CLOCK)
      const frame = new AudioData({
        format: 'f32-planar',
        numberOfChannels: 1,
        numberOfFrames: data.length,
        timestamp: Math.round((offset * 1e6) / OPUS_CLOCK),
        sampleRate: OPUS_CLOCK,
        data,
      })
      try {
        encoder.encode(frame)
      } finally {
        frame.close()
      }
      while (encoder.encodeQueueSize > 4) {
        await new Promise<void>((resolve) => setTimeout(resolve, 4))
        if (failure) throw failure
      }
    }
    await encoder.flush()
    if (failure) throw failure
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }
  if (!idHeader || idHeader.length !== 19)
    throw new Error('录音编码器缺少 Opus 标识')
  const header = new DataView(idHeader.buffer)
  header.setUint32(12, RATE, true)
  const preSkip = header.getUint16(10, true)
  const totalGranule = preSkip + samples * 3
  const packetFrames = 960
  const needed = Math.ceil(totalGranule / packetFrames)
  if (packets.length < needed) throw new Error('录音编码不完整，请重试')
  const tags = new Uint8Array(16)
  tags.set(new TextEncoder().encode('OpusTags'))
  const serial = crypto.getRandomValues(new Uint32Array(1))[0]
  const pages = [
    oggPage([idHeader], 2, 0, serial, 0),
    oggPage([tags], 0, 0, serial, 1),
  ]
  for (let i = 0; i < needed; i += 25) {
    const end = Math.min(i + 25, needed)
    const last = end === needed
    pages.push(
      oggPage(
        packets.slice(i, end),
        last ? 4 : 0,
        last ? totalGranule : end * packetFrames,
        serial,
        pages.length,
      ),
    )
  }
  return { blob: new Blob(pages, { type: 'audio/ogg' }), samples }
}
