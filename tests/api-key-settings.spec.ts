import { expect, test, type Page } from '@playwright/test'
import type { ApiKeySetting, ApiKeyUpdate } from '../src/lib/desktop'

const original: ApiKeySetting = {
  id: 'env:EXAMPLE_API_KEY',
  usages: ['主 Agent', '活动时间线压缩'],
  configured: true,
  masked: '••••1234',
}
const vision: ApiKeySetting = {
  id: 'slot:vision',
  usages: ['截图识别'],
  configured: false,
  masked: null,
}

async function openKeys(
  page: Page,
  read: () => ApiKeySetting[] | Promise<ApiKeySetting[]>,
  save: (update: ApiKeyUpdate) => ApiKeySetting[] | Promise<ApiKeySetting[]>,
) {
  await page.exposeFunction('readKeyFixture', read)
  await page.exposeFunction('saveKeyFixture', save)
  await page.addInitScript(() => {
    let state = {
      appearance: 'system',
      configured: true,
      connectionRevision: 1,
      terminal: 'desk-one',
      url: 'https://example.test',
      messages: [],
    }
    const fixture = window as unknown as {
      readKeyFixture(): Promise<ApiKeySetting[]>
      saveKeyFixture(value: ApiKeyUpdate): Promise<ApiKeySetting[]>
    }
    Object.assign(window, {
      wintermute: {
        state: async () => state,
        subscribe: (callback: (next: typeof state) => void) => {
          const changed = (event: Event) => {
            state = { ...state, ...(event as CustomEvent).detail }
            callback(state)
          }
          window.addEventListener('fixture-connection', changed)
          return () => window.removeEventListener('fixture-connection', changed)
        },
        apiKeys: () => fixture.readKeyFixture(),
        updateApiKey: (value: ApiKeyUpdate) => fixture.saveKeyFixture(value),
      },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '终端设置', exact: true }).click()
  await page.getByRole('button', { name: '接口密钥', exact: true }).click()
  return page.getByRole('dialog')
}

test('shows shared uses and a masked status, and changes only the selected backend key', async ({
  page,
}) => {
  const writes: ApiKeyUpdate[] = []
  let keys = [original, vision]
  const dialog = await openKeys(
    page,
    () => keys,
    (update) => {
      writes.push(update)
      keys = [{ ...original, masked: '••••AAAA' }, vision]
      return keys
    },
  )
  const row = dialog.getByRole('region', {
    name: '主 Agent、活动时间线压缩',
    exact: true,
  })
  await expect(row).toContainText('••••1234')
  await expect(dialog.getByRole('region', { name: '截图识别' })).toContainText(
    '未配置',
  )
  await row.getByRole('button', { name: '更换' }).click()
  const field = row.getByLabel('新密钥', { exact: true })
  const save = row.getByRole('button', { name: '保存密钥' })
  await expect(field).toHaveValue('')
  await expect(field).toHaveAttribute('type', 'password')
  await field.fill('  ')
  await expect(save).toBeDisabled()
  await field.fill(' local-fixture-key-AAAA ')
  await row.getByRole('button', { name: '显示新密钥' }).click()
  await expect(field).toHaveAttribute('type', 'text')
  await row.getByRole('button', { name: '隐藏新密钥' }).click()
  await save.click()
  await expect(row).toContainText('••••AAAA')
  await expect(dialog.getByRole('status')).toContainText('密钥已保存')
  await expect(field).toHaveCount(0)
  expect(writes).toEqual([
    {
      id: original.id,
      apiKey: 'local-fixture-key-AAAA',
      connectionRevision: 1,
    },
  ])
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain('local-fixture-key-AAAA')
  await row.getByRole('button', { name: '更换' }).click()
  await expect(field).toHaveValue('')
})

test('discards drafts on connection changes and ignores a late read for the old terminal', async ({
  page,
}) => {
  let answer: () => ApiKeySetting[] | Promise<ApiKeySetting[]> = () => [
    original,
  ]
  const dialog = await openKeys(
    page,
    () => answer(),
    () => [],
  )
  const field = dialog.getByLabel('新密钥', { exact: true })
  await dialog.getByRole('button', { name: '更换' }).click()
  await field.fill('abandoned-local-fixture')
  let finish!: (items: ApiKeySetting[]) => void
  answer = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const change = (revision: number) =>
    page.evaluate(
      (connectionRevision) =>
        window.dispatchEvent(
          new CustomEvent('fixture-connection', {
            detail: { connectionRevision },
          }),
        ),
      revision,
    )
  await change(2)
  await expect(field).toHaveCount(0)
  await expect.poll(() => !!finish).toBe(true)
  answer = () => [vision]
  await change(3)
  await expect(dialog.getByRole('heading', { name: '截图识别' })).toBeVisible()
  finish([original])
  await dialog
    .getByRole('region', { name: '截图识别' })
    .getByRole('button', { name: '设置', exact: true })
    .click()
  await expect(field).toHaveValue('')
  await expect(dialog).not.toContainText('••••1234')
})

test('explains permission and server errors without echoing arbitrary exception text', async ({
  page,
}) => {
  let reason = '此终端没有管理接口密钥的权限'
  const dialog = await openKeys(
    page,
    () => {
      if (reason) throw new Error(reason)
      return [original]
    },
    () => {
      throw new Error('arbitrary input: local-fixture-key')
    },
  )
  const alert = dialog.getByRole('alert')
  await expect(alert).toHaveText(reason)
  const refresh = dialog.getByRole('button', { name: '刷新' })
  for (const message of [
    '当前后端不支持接口密钥管理，请更新后端',
    '无法连接后端，请检查连接后重试',
  ]) {
    reason = message
    await refresh.click()
    await expect(alert).toHaveText(reason)
  }
  reason = ''
  await refresh.click()
  await dialog.getByRole('button', { name: '更换' }).click()
  await dialog.getByLabel('新密钥', { exact: true }).fill('local-fixture-key')
  await dialog.getByRole('button', { name: '保存密钥' }).click()
  await expect(alert).toHaveText('管理接口密钥失败，请刷新后重试')
  await expect(dialog).not.toContainText('local-fixture-key')
  await expect(dialog.locator('input')).toHaveCount(0)
})
