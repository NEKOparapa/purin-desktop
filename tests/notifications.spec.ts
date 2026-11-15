import { test, expect } from '@playwright/test'

test('device notifications show filenames and sizes and save only the attachment clicked', async ({
  page,
}) => {
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
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '通知', exact: true })
    .click()
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
