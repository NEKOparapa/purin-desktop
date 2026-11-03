import { test, expect } from '@playwright/test'

test('home, search, details and local chat', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: '慢慢来，我一直在。' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '记忆空间', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索记忆' }).fill('不存在')
  await expect(page.getByText('没有找到相关记忆')).toBeVisible()
  await page.getByRole('textbox', { name: '搜索记忆' }).fill('专注')
  await page.getByRole('button', { name: /专注，也需要一些边界/ }).click()
  await expect(page.getByRole('dialog')).toContainText('尚未创建真实日程')
  await page.getByRole('button', { name: '知道了' }).click()
  await page.getByRole('button', { name: '我的设备', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Wintermute Desktop' }),
  ).toBeVisible()
  await page
    .getByRole('textbox', { name: '发送给 Wintermute' })
    .fill('你好，Wintermute')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('Wintermute · 模拟回复')
  await expect(page.getByRole('log')).toContainText('你好，Wintermute')
  expect(errors).toEqual([])
})

test('compact desktop window has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 680 })
  await page.goto('/')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: '聊一聊今天' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})
