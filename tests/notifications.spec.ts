import { test, expect, type Page } from '@playwright/test'
import type { NoticeAlert } from '../src/lib/desktop'

async function openDesktop(page: Page) {
  const requests: string[] = []
  await page.exposeFunction('track', (s: string) => {
    requests.push(s)
  })
  await page.addInitScript(() => {
    const bridge = window as unknown as { track(s: string): Promise<void> }
    Object.assign(window, {
      wintermute: {
        state: async () => ({
          configured: true,
          terminal: 'desktop',
          url: 'http://test',
          appearance: 'light',
          messages: [],
        }),
        subscribe: () => () => {},
        schedule: async () => ({ items: [], next_cursor: null }),
        onNotice: (callback: (alert: NoticeAlert) => void) => {
          const listener = (event: Event) =>
            callback((event as CustomEvent<NoticeAlert>).detail)
          window.addEventListener('test-notice', listener)
          return () => window.removeEventListener('test-notice', listener)
        },
        notificationPage: async () => ({
          items: [
            {
              id: 'notice',
              title: '会议附件',
              body: '请核对报价单。',
              created_at: '2026-11-16T04:00:00Z',
              read_at: null,
              expired: false,
              attachments: [
                { id: 'a', name: '报价单.pdf', size_bytes: 2048 },
                { id: 'b', name: '议程.txt', size_bytes: 10 },
              ],
            },
          ],
          next_cursor: null,
        }),
        readNotification: async (id: string) => bridge.track('read ' + id),
        downloadNotificationFile: async ({
          notificationId,
          file,
        }: {
          notificationId: string
          file: { id: string }
        }) => {
          await bridge.track('download ' + notificationId + ' ' + file.id)
          return { saved: true }
        },
      },
    })
  })
  await page.goto('/')
  return requests
}

test('device notifications show filenames and sizes and save only the attachment clicked', async ({
  page,
}) => {
  const requests = await openDesktop(page)
  const navigation = page.getByRole('navigation', { name: '主导航' })
  await expect(
    navigation.getByRole('button', { name: /日历|通知|日程/ }),
  ).toHaveCount(1)
  const entry = navigation.getByRole('button', { name: '日程' })
  await entry.click()
  const inbox = page.getByRole('region', { name: '通知', exact: true })
  const calendar = page.getByRole('region', { name: '日历', exact: true })
  await expect(inbox.getByText('请核对报价单。')).toBeVisible()
  await expect(calendar.getByRole('button', { name: '今天' })).toBeVisible()
  const inboxBox = (await inbox.boundingBox())!
  expect(inboxBox.y + inboxBox.height).toBeLessThanOrEqual(
    (await calendar.boundingBox())!.y,
  )
  await expect(page.getByRole('tab')).toHaveCount(0)
  expect(requests).toEqual([])
  await expect(entry).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: /会议附件/ }).click()
  await expect(page.getByRole('list', { name: '附件' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: /报价单.pdf.*2 KB/ }),
  ).toBeVisible()
  await expect.poll(() => requests).toEqual(['read notice'])
  await page.getByRole('button', { name: /议程.txt/ }).click()
  await expect(page.getByRole('status')).toHaveText('已保存 议程.txt')
  expect(requests).toEqual(['read notice', 'download notice b'])
})

test('banner and system notification clicks open the matching notice in the shared page', async ({
  page,
}) => {
  await openDesktop(page)
  const entry = page
    .getByRole('navigation')
    .getByRole('button', { name: '日程' })
  await entry.click()
  const emitNotice = (open: boolean) =>
    page.evaluate((open) => {
      window.dispatchEvent(
        new CustomEvent<NoticeAlert>('test-notice', {
          detail: {
            id: 'notice',
            title: '会议附件',
            body: '请核对报价单。',
            terminal: 'desktop',
            url: 'http://test',
            open,
          },
        }),
      )
    }, open)
  await emitNotice(false)
  await page
    .getByRole('status', { name: '新通知' })
    .getByRole('button', { name: /会议附件/ })
    .click()
  const inbox = page.getByRole('region', { name: '通知', exact: true })
  const summary = inbox.getByRole('button', { name: /会议附件/ })
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  await summary.click()
  const calendar = page.getByRole('region', { name: '日历', exact: true })
  await calendar.getByRole('button', { name: '下个月' }).click()
  const month = await calendar.getByRole('group').getAttribute('aria-label')
  await emitNotice(true)
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  await expect(calendar.getByRole('group')).toHaveAccessibleName(month!)
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '对话' })
    .click()
  await emitNotice(true)
  await expect(entry).toHaveAttribute('aria-current', 'page')
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
})
