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

test('renders published sections as inert text and clears them for unconfigured or failed reads', async ({
  page,
}) => {
  let next: UserProfileDocument | Error = {
    status: 'ready',
    effective: true,
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
  await expect(page.getByRole('status')).toContainText('已生效')
  await expect(doc).toContainText('仅供后台判断空闲时段')
  await expect(doc).toContainText('<img src=')
  await expect(doc.locator('img,script')).toHaveCount(0)
  const refresh = page.getByRole('button', { name: '刷新', exact: true })
  next = new Error('当前后端不支持用户档案，请更新后端。')
  await refresh.click()
  await expect(page.getByRole('alert')).toContainText('请更新后端')
  await expect(doc).toHaveCount(0)
  next = { status: 'unconfigured', markdown: '', effective: false }
  await refresh.click()
  await expect(page.getByText('后端尚未配置用户档案。')).toBeVisible()
  next = new Error('无法连接后端')
  await refresh.click()
  await expect(page.getByRole('alert')).toContainText('无法连接后端')
})

test('shows the initial template and updates activation independently of published statistics', async ({
  page,
}) => {
  const initial: UserProfileDocument = {
    status: 'empty',
    effective: false,
    markdown:
      '## 基本信息\n- 称呼：\n\n## 长期偏好\n\n## 日常习惯\n\n## 近期状态\n\n## 常用时间段\n- 工作日常见活跃时段：',
  }
  let next = initial
  await openProfile(page, () => next)
  const doc = page.getByRole('article', { name: '档案内容' })
  const status = page.getByRole('status')
  const refresh = page.getByRole('button', { name: '刷新', exact: true })
  await expect(page.getByRole('heading', { name: '初始档案' })).toBeVisible()
  await expect(status).toContainText('尚未生效')
  await expect(doc.getByRole('heading')).toHaveText([
    '基本信息',
    '长期偏好',
    '日常习惯',
    '近期状态',
    '常用时间段',
  ])
  await expect(doc.getByRole('listitem').first()).toHaveText('称呼：待补充')
  await expect(
    doc.getByRole('heading', { name: '长期偏好' }).locator('+ p'),
  ).toHaveText('待补充')
  next = {
    status: 'ready',
    markdown: '## 常用时间段\n- 工作日：12:00–14:00',
    effective: false,
  }
  await refresh.click()
  await expect(doc).toContainText('12:00–14:00')
  await expect(status).toContainText('尚未生效')
  next = {
    status: 'ready',
    markdown: '## 长期偏好\n- 用户偏好中文。',
    effective: true,
  }
  await refresh.click()
  await expect(doc).toContainText('用户偏好中文。')
  await expect(status).toContainText('已生效')
  const template = page.getByRole('article', { name: '初始模板内容' })
  await expect(template).toBeHidden()
  await page.getByText('查看初始模板', { exact: true }).click()
  await expect(template.getByRole('heading')).toHaveText([
    '基本信息',
    '长期偏好',
    '日常习惯',
    '近期状态',
    '常用时间段',
  ])
  await expect(
    page.getByText('初始模板 · 未生效', { exact: true }),
  ).toBeVisible()
  await expect(status).toContainText('已生效')
  await expect(template).not.toContainText('用户偏好中文。')
  next = { ...next, effective: null }
  await refresh.click()
  await expect(status).toContainText('生效状态未知')
  next = initial
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(status).toContainText('尚未生效')
  await expect(doc).not.toContainText('用户偏好中文。')
  await expect(page.getByText('查看初始模板', { exact: true })).toHaveCount(0)
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
      : {
          status: 'ready',
          markdown: '## 基本信息\n- ' + account,
          effective: true,
        },
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
  release({ status: 'ready', markdown: '迟到的旧档案', effective: true })
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
