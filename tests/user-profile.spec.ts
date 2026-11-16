import { expect, test, type Page } from '@playwright/test'
import type { UserProfileDocument } from '../src/lib/desktop'

async function openProfile(
  page: Page,
  read: () => Promise<UserProfileDocument> | UserProfileDocument,
) {
  await page.exposeFunction('readProfileFixture', read)
  await page.addInitScript(() => {
    let state = {
      appearance: 'system',
      configured: true,
      url: 'https://example.test',
      terminal: 'http-desktop',
      messages: [],
      connectionRevision: 1,
    }
    Object.assign(window, {
      wintermute: {
        state: async () => state,
        subscribe: (notify: (value: typeof state) => void) => {
          const changed = (event: Event) => {
            state = { ...state, ...(event as CustomEvent).detail }
            notify(state)
          }
          window.addEventListener('fixture-connection', changed)
          return () => window.removeEventListener('fixture-connection', changed)
        },
        history: async () => ({ items: [], next_cursor: null }),
        userProfile: () =>
          (
            window as unknown as {
              readProfileFixture: () => Promise<UserProfileDocument>
            }
          ).readProfileFixture(),
      },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '记忆', exact: true }).click()
  await page.getByRole('button', { name: '用户档案', exact: true }).click()
}

test('renders published sections as inert text and refreshes empty, unconfigured or failed reads', async ({
  page,
}) => {
  let next: UserProfileDocument | Error = {
    status: 'ready',
    markdown:
      '## 近期状态\n- 准备演示（有效至或复核于 2026-11-20）\n\n## 常用时间段\n- 工作日：09:00–11:30\n\n<img src="/invalid" onerror="alert(1)">',
  }
  await openProfile(page, () => {
    if (next instanceof Error) throw next
    return next
  })
  const doc = page.getByRole('article', { name: '档案内容' })
  await expect(doc.getByRole('heading', { name: '近期状态' })).toBeVisible()
  await expect(doc.getByRole('listitem')).toHaveCount(2)
  await expect(doc).toContainText('有效至或复核于 2026-11-20')
  await expect(doc).toContainText('09:00–11:30')
  await expect(doc).toContainText('<img src=')
  await expect(doc.locator('img,script')).toHaveCount(0)
  next = { status: 'empty', markdown: '' }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText(/档案暂无内容/)).toBeVisible()
  await expect(doc).toHaveCount(0)
  const refresh = page.getByRole('button', { name: '刷新', exact: true })
  next = new Error('当前后端不支持用户档案，请更新后端。')
  await refresh.click()
  await expect(page.getByRole('alert')).toContainText('请更新后端')
  next = { status: 'unconfigured', markdown: '' }
  await refresh.click()
  await expect(page.getByText('后端尚未配置用户档案。')).toBeVisible()
  next = new Error('无法连接后端')
  await refresh.click()
  await expect(page.getByRole('alert')).toContainText('无法连接后端')
})

test('drops previous profile and in-flight reads when identity changes at the same URL', async ({
  page,
}) => {
  let account = 'first'
  let release!: (value: UserProfileDocument) => void
  await openProfile(page, () =>
    account === 'pending'
      ? new Promise((resolve) => {
          release = resolve
        })
      : { status: 'ready', markdown: '## 基本信息\n- ' + account },
  )
  await expect(page.getByText('first', { exact: true })).toBeVisible()
  account = 'pending'
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect.poll(() => !!release).toBe(true)
  account = 'second'
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('fixture-connection', {
        detail: { connectionRevision: 2 },
      }),
    ),
  )
  await expect(page.getByText('second', { exact: true })).toBeVisible()
  release({ status: 'ready', markdown: '迟到的旧档案' })
  await expect(page.getByRole('article', { name: '档案内容' })).toHaveText(
    /second/,
  )
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('fixture-connection', { detail: { configured: false } }),
    ),
  )
  await expect(page.getByText('连接后可查看用户档案')).toBeVisible()
  await expect(page.getByRole('article', { name: '档案内容' })).toHaveCount(0)
})
