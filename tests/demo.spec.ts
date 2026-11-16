import { test, expect } from '@playwright/test'

test('appearance follows live system changes and remembers a manual choice', async ({
  page,
}) => {
  const canvas = page.locator('.workspace')
  const white = 'rgb(255, 255, 255)'
  const graphite = 'rgb(22, 23, 27)'
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(canvas).toHaveCSS('background-color', graphite)
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(canvas).toHaveCSS('background-color', white)
  await page.getByRole('button', { name: '终端设置', exact: true }).click()
  await expect(page.getByLabel('服务地址')).toBeVisible()
  await expect(page.getByRole('radio', { name: '跟随系统' })).toHaveCount(0)
  await page.getByRole('button', { name: '外观', exact: true }).click()
  await expect(page.getByLabel('服务地址')).toHaveCount(0)
  await expect(page.getByRole('radio', { name: '跟随系统' })).toBeChecked()
  await page.getByRole('radio', { name: '深色' }).check()
  await expect(canvas).toHaveCSS('background-color', graphite)
  await page.reload()
  await expect(canvas).toHaveCSS('background-color', graphite)
  await page.getByRole('button', { name: '终端设置', exact: true }).click()
  await page.getByRole('button', { name: '外观', exact: true }).click()
  await page.getByRole('radio', { name: '浅色' }).check()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(canvas).toHaveCSS('background-color', white)
  await page.getByRole('radio', { name: '跟随系统' }).check()
  await expect(canvas).toHaveCSS('background-color', graphite)
})

test('connection settings are reachable from disconnected memory and chat', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: '有什么想聊的？' }),
  ).toBeVisible()
  const draft = page.getByRole('textbox', { name: '对话消息' })
  await page.getByRole('button', { name: '整理会议', exact: true }).click()
  await expect(draft).toHaveValue(/会议/)
  await page.getByRole('button', { name: '记忆', exact: true }).click()
  await expect(page.getByText('连接后可浏览后端历史记录')).toBeVisible()
  await page.getByRole('button', { name: '连接设置', exact: true }).click()
  await expect(
    page.getByRole('dialog').getByText('未连接', { exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('服务地址')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await expect(draft).toHaveValue(/会议/)
  await draft.press('Enter')
  await expect(page.getByRole('dialog').getByLabel('终端 ID')).toBeVisible()
  await expect(page.getByRole('button', { name: '验证并保存' })).toBeDisabled()
  await page.getByRole('button', { name: '信息采集' }).click()
  const settings = page.getByRole('dialog')
  await expect(
    settings.getByRole('checkbox', { name: '分享桌面活动' }),
  ).toBeVisible()
  await expect(
    settings.getByRole('checkbox', { name: '浏览器接入' }),
  ).toBeVisible()
  await expect(
    settings.getByRole('checkbox', { name: '采集前台窗口代表帧' }),
  ).toBeDisabled()
  await expect(settings.getByRole('checkbox')).toHaveCount(3)
  await expect(settings).toContainText('窗口标题')
  await expect(settings).not.toContainText('日历')
  expect(errors).toEqual([])
})

test('collapsed navigation keeps page controls accessible and survives a reload', async ({
  page,
}) => {
  await page.goto('/')
  const sidebar = page.getByRole('complementary')
  const navigation = page.getByRole('navigation', { name: '主导航' })
  await expect(navigation.getByRole('button', { name: '设备' })).toHaveCount(0)
  const width = () =>
    sidebar.evaluate((element) => element.getBoundingClientRect().width)
  const expandedWidth = await width()
  const collapse = page.getByRole('button', { name: '收起导航栏' })
  const expand = page.getByRole('button', { name: '展开导航栏' })
  await collapse.click()
  await expect.poll(width).toBeLessThan(expandedWidth)
  await navigation.getByRole('button', { name: '记忆' }).click()
  await expect(
    page.getByRole('heading', { name: '记忆', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('工作空间', { exact: true })).toHaveCount(0)
  await expect(sidebar.getByText('http-desktop', { exact: true })).toHaveCount(
    0,
  )
  await page.reload()
  await expect(expand).toBeVisible()
  await expect.poll(width).toBeLessThan(expandedWidth)
  await sidebar.getByRole('button', { name: '终端设置' }).click()
  await expect(page.getByRole('dialog').getByLabel('终端 ID')).toHaveValue(
    'http-desktop',
  )
  await page.keyboard.press('Escape')
  await expand.focus()
  await page.keyboard.press('Enter')
  await expect(collapse).toBeVisible()
  await expect.poll(width).toBe(expandedWidth)
})

test('editing a connection preserves the active terminal and its failed material', async ({
  page,
}) => {
  const actions: Array<[string, boolean]> = []
  await page.exposeFunction(
    'handleFailedMaterial',
    (id: string, retry: boolean) => {
      actions.push([id, retry])
    },
  )
  await page.addInitScript(() => {
    Object.assign(window, {
      wintermute: {
        state: async () => ({
          url: 'https://meeting.example',
          terminal: 'meeting-desktop',
          configured: true,
          appearance: 'system',
          messages: [],
          pendingMaterials: 1,
          failedMaterial: 'audio-1',
          materialIssue: '上传失败 · HTTP 400',
        }),
        subscribe: () => () => {},
        manageFailed: (
          window as unknown as {
            handleFailedMaterial(id: string, retry: boolean): Promise<void>
          }
        ).handleFailedMaterial,
      },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '终端设置' }).click()
  const settings = page.getByRole('dialog')
  await expect(settings.getByText('已连接', { exact: true })).toBeVisible()
  await expect(
    settings.getByText('https://meeting.example', { exact: true }),
  ).toBeVisible()
  await settings.getByRole('button', { name: '编辑连接' }).click()
  await settings.getByLabel('终端 ID').fill('other-desktop')
  await settings.getByRole('button', { name: '取消', exact: true }).click()
  await expect(
    settings.getByText('meeting-desktop', { exact: true }),
  ).toBeVisible()
  await expect(
    settings.getByText('other-desktop', { exact: true }),
  ).toHaveCount(0)
  await expect(settings.getByRole('button', { name: '重试此项' })).toHaveCount(
    0,
  )
  await settings.getByRole('button', { name: '信息采集' }).click()
  await expect(settings).toContainText('上传失败 · HTTP 400')
  await settings.getByRole('button', { name: '重试此项' }).click()
  await settings.getByRole('button', { name: '丢弃此项' }).click()
  await expect
    .poll(() => actions)
    .toEqual([
      ['audio-1', true],
      ['audio-1', false],
    ])
})

test('compact window, IME composition and multiline input', async ({
  page,
}) => {
  await page.setViewportSize({ width: 860, height: 680 })
  await page.goto('/')
  const input = page.getByRole('textbox', { name: '对话消息' })
  await input.fill('会议')
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await input.press('Shift+Enter')
  await expect(input).toHaveValue('会议\n')
  const buttons = [
    page.getByRole('button', { name: '发送对话消息' }),
    page.getByRole('button', { name: '终端设置', exact: true }),
  ]
  for (const btn of buttons) await expect(btn).toBeInViewport()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})
