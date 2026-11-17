import { test, expect, type Page } from '@playwright/test'
import type {
  ScheduleEntry,
  ScheduleRange,
  ResultsPage,
} from '../src/lib/desktop'

test.use({ timezoneId: 'America/New_York' })

function item(
  id: string,
  title: string,
  trigger_at: string,
  status: ScheduleEntry['status'] = 'scheduled',
): ScheduleEntry {
  return {
    id,
    title,
    trigger_at,
    status,
    content: '查看本次评审的验收结果。',
    action: 'notify_agent',
  }
}

async function openCalendar(
  page: Page,
  schedule: (
    range: ScheduleRange,
  ) => ResultsPage<ScheduleEntry> | Promise<ResultsPage<ScheduleEntry>>,
) {
  await page.clock.setFixedTime(new Date('2026-03-15T15:00:00Z'))
  await page.exposeFunction('readSchedule', schedule)
  await page.addInitScript(() => {
    const fixture = window as unknown as {
      readSchedule: (
        range: ScheduleRange,
      ) => Promise<ResultsPage<ScheduleEntry>>
    }
    Object.assign(window, {
      wintermute: {
        state: async () => ({
          url: 'https://fixture.invalid',
          terminal: 'desktop',
          appearance: 'light',
          configured: true,
          messages: [],
        }),
        subscribe: () => () => {},
        notificationPage: async () => ({ items: [], next_cursor: null }),
        schedule: fixture.readSchedule,
      },
    })
  })
  await page.goto('/')
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '日程', exact: true })
    .click()
}

test('month boundaries follow local time across DST and paginated items share a day agenda', async ({
  page,
}) => {
  const reads: ScheduleRange[] = []
  let triggered = false
  await openCalendar(page, (query) => {
    reads.push(query)
    const first = item(
      'a',
      '月末复盘',
      '2026-04-01T03:30:10Z',
      triggered ? 'triggered' : 'scheduled',
    )
    return query.cursor
      ? {
          items: [
            first,
            item('b', '确认发布', '2026-03-31T13:00:00Z', 'triggered'),
          ],
          next_cursor: null,
        }
      : { items: [first], next_cursor: 'next' }
  })
  const lastDay = page.getByRole('button', {
    name: '2026年3月31日，2项安排',
    exact: true,
  })
  await lastDay.click()
  const agenda = page.getByRole('region', { name: '当天安排' })
  await expect(agenda.getByRole('listitem')).toHaveCount(2)
  await expect(agenda.getByRole('listitem').first()).toContainText('09:00')
  await expect(agenda.getByRole('listitem').last()).toContainText('23:30:10')
  await expect(agenda.getByRole('listitem').last()).toContainText('待触发')
  expect(reads.map((r) => r.cursor)).toContain('next')
  expect(
    reads.every(
      (r) =>
        r.start === '2026-03-01T05:00:00.000Z' &&
        r.end === '2026-04-01T04:00:00.000Z',
    ),
  ).toBeTruthy()
  triggered = true
  await page.getByRole('button', { name: '刷新日历' }).click()
  await expect(agenda.getByRole('listitem').last()).toContainText('已触发')
  await lastDay.focus()
  await page.keyboard.press('ArrowRight')
  await expect(
    page.getByRole('button', { name: /^2026年4月1日/ }),
  ).toBeFocused()
})

test('a late month response cannot overwrite the selected month and errors can be retried', async ({
  page,
}) => {
  let release!: (page: ResultsPage<ScheduleEntry>) => void
  const wait = new Promise<ResultsPage<ScheduleEntry>>((resolve) => {
    release = resolve
  })
  let fail = true
  await openCalendar(page, async (q) => {
    if (q.start.startsWith('2026-03')) return wait
    if (fail) throw new Error('网络暂时不可用')
    return {
      items: [item('apr', '四月排期', '2026-04-15T14:00:00Z')],
      next_cursor: null,
    }
  })
  await page.getByRole('button', { name: '下个月' }).click()
  await expect(page.getByRole('alert')).toContainText('网络暂时不可用')
  fail = false
  await page.getByRole('button', { name: '刷新日历' }).click()
  await expect(page.getByRole('heading', { name: '四月排期' })).toBeVisible()
  release({
    items: [item('late', '三月旧数据', '2026-03-15T12:00:00Z')],
    next_cursor: null,
  })
  await expect(page.getByRole('heading', { name: '四月排期' })).toBeVisible()
  await expect(page.getByText('三月旧数据')).toHaveCount(0)
  await page
    .getByRole('button', { name: '2026年4月16日，0项安排', exact: true })
    .click()
  await expect(page.getByText('当天没有安排')).toBeVisible()
})
