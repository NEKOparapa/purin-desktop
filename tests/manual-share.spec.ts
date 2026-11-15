import { test, expect } from '@playwright/test'

test('sharing requires confirmation for text, screenshots and microphone clips', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const sent: unknown[] = []
    const baseState = {
      appearance: 'system',
      url: 'http://127.0.0.1',
      terminal: 'demo',
      configured: true,
      collecting: false,
      lastSpan: null,
      issue: '',
      sampleIssue: '',
      messages: [],
    }
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 80
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, 200, 80)
    ctx.fillStyle = 'black'
    ctx.fillText('Meeting moved to Friday', 20, 40)
    const fixture = {
      state: async () => baseState,
      subscribe: () => () => {},
      listShareWindows: async () => [{ id: 'demo', name: '会议纪要' }],
      captureShareWindow: async () => canvas.toDataURL('image/jpeg'),
      shareMaterial: async (value: unknown) => {
        sent.push(value)
      },
    }
    Object.assign(window, { wintermute: fixture, shared: sent })
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        const ac = new AudioContext()
        await ac.resume()
        const tone = ac.createOscillator()
        const dest = ac.createMediaStreamDestination()
        tone.connect(dest)
        tone.start()
        return dest.stream
      },
    })
  })
  await page.goto('/')
  const launch = page.getByRole('button', { name: '分享素材' })
  const save = page.getByRole('button', { name: '确认分享' })
  const count = () =>
    page.evaluate(
      () => (window as unknown as { shared: unknown[] }).shared.length,
    )
  await launch.click()
  await page
    .getByRole('textbox', { name: '文字内容' })
    .fill('本周演示推迟到周五')
  await expect(save).toBeEnabled()
  expect(await count()).toBe(0)
  await save.click()
  await expect(launch).toBeVisible()
  await launch.click()
  await page.getByRole('button', { name: '截图', exact: true }).click()
  await page.getByRole('button', { name: '选择窗口' }).click()
  await page.getByRole('button', { name: '截取预览' }).click()
  await expect(page.getByAltText('待分享的截图')).toBeVisible()
  expect(await count()).toBe(1)
  await save.click()
  await launch.click()
  await page.getByRole('button', { name: '录音', exact: true }).click()
  await page.getByRole('button', { name: '开始录音' }).click()
  await expect(page.getByText(/录音中/)).toBeVisible()
  await expect(save).toBeDisabled()
  await page.waitForFunction(() =>
    document.body.textContent?.includes('录音中 · 0:01'),
  )
  await page.getByRole('button', { name: '停止录音' }).click()
  await expect(page.getByLabel('试听待分享的录音')).toBeVisible()
  expect(await count()).toBe(2)
  await save.click()
  await expect.poll(count).toBe(3)
  const result = await page.evaluate(
    () =>
      (
        window as unknown as {
          shared: { kind: string; samples?: number; oggBase64?: string }[]
        }
      ).shared,
  )
  expect(result.map((s) => s.kind)).toEqual(['text', 'image', 'audio'])
  expect(result[2].samples).toBeGreaterThan(0)
  expect(atob(result[2].oggBase64!).slice(0, 4)).toBe('OggS')
})
