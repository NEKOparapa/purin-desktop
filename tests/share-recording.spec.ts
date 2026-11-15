import { test, expect } from '@playwright/test'

test('a generated microphone clip is encoded to a playable mono Opus recording', async ({
  page,
}) => {
  await page.goto('/')
  const clip = await page.evaluate(async () => {
    const { encodeRecording } = await import('/src/lib/opus-clip.ts')
    const context = new AudioContext()
    const source = context.createOscillator()
    const destination = context.createMediaStreamDestination()
    source.connect(destination)
    const options = { mimeType: 'audio/webm;codecs=pcm' }
    const recorder = new MediaRecorder(destination.stream, options)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })
    await context.resume()
    recorder.start()
    source.start()
    await new Promise((resolve) => setTimeout(resolve, 250))
    recorder.stop()
    await stopped
    source.stop()
    destination.stream.getTracks().forEach((track) => track.stop())
    await context.close()
    const result = await encodeRecording(
      new Blob(chunks, { type: options.mimeType }),
    )
    const bytes = await result.blob.arrayBuffer()
    const playback = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(
      bytes.slice(0),
    )
    const pcm = playback.getChannelData(0)
    let peak = 0
    for (const v of pcm) peak = Math.max(peak, Math.abs(v))
    const view = new DataView(bytes)
    // First page contains the identification packet. Its payload starts at 28.
    return {
      samples: result.samples,
      decodedSamples: pcm.length,
      channels: playback.numberOfChannels,
      peak,
      signature: new TextDecoder().decode(bytes.slice(0, 4)),
      inputRate: view.getUint32(40, true),
    }
  })
  expect(clip.signature).toBe('OggS')
  expect(clip.samples).toBeGreaterThan(0)
  expect(clip.inputRate).toBe(16000)
  expect(clip.channels).toBe(1)
  expect(Math.abs(clip.decodedSamples - clip.samples)).toBeLessThan(10)
  expect(clip.peak).toBeGreaterThan(0.2)
})
