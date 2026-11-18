import { test, expect, type Page } from '@playwright/test'
import type { HistoryFile, HistoryPage, HistoryView, TerminalToolCall } from '../src/lib/desktop'

type Query = { view: HistoryView; cursor?: string; groupId?: string }

async function openMemory(
  page: Page,
  read: (query: Query) => Promise<HistoryPage> | HistoryPage,
  download: (file: HistoryFile) => { saved: boolean } = () => ({ saved: true }),
  preview: (request: { id: string; connectionRevision: number }) => void | Promise<void> = () => {},
) {
  await page.exposeFunction('readFixture', read)
  await page.exposeFunction('downloadFixture', download)
  await page.exposeFunction('previewFixture', preview)
  await page.addInitScript(() => {
    const fixture = window as unknown as {
      readFixture: (query: Query) => Promise<HistoryPage>
      downloadFixture: (file: HistoryFile) => Promise<{ saved: boolean }>
      previewFixture: (request: { id: string; connectionRevision: number }) => Promise<void>
    }
    Object.assign(window, {
      wintermute: {
        state: async () => ({
          configured: true,
          connectionRevision: 1,
          url: 'https://wintermute.example',
          terminal: 'desktop',
          appearance: 'system',
          messages: [],
        }),
        subscribe: () => () => {},
        history: (query: Query) => fixture.readFixture(query),
        previewHistoryImage: async (request: { id: string; connectionRevision: number }) => {
          await fixture.previewFixture(request)
          const canvas = document.createElement('canvas')
          canvas.width = 8
          canvas.height = 4
          const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg'))
          return blob!.arrayBuffer()
        },
        downloadHistoryFile: (file: HistoryFile) =>
          fixture.downloadFixture(file),
      },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '记忆', exact: true }).click()
}

function item(id: string, text: string, files: HistoryFile[] = []) {
  return {
    id,
    text,
    files,
    occurred_at: '2026-11-14T09:15:00+08:00',
    role: 'user',
    source: '用户原话 · 桌面',
  }
}

test('terminal call history shows paginated, live results from all targets', async ({ page }) => {
  const current: TerminalToolCall = {
    id: 'a', terminal_id: '会议电脑', tool: 'shell', arguments: { command: 'hostname' },
    timeout_seconds: 15, status: 'running', created_at: '2026-11-17T08:00:00Z',
    started_at: '2026-11-17T08:00:01Z', completed_at: null,
    stdout: '', stderr: '', exit_code: null, truncated: false,
  }
  const past: TerminalToolCall = {
    ...current, id: 'b', terminal_id: '另一台电脑', arguments: { command: 'missing-command' },
    status: 'failed', completed_at: '2026-11-17T08:00:02Z',
    stderr: '<img src=x onerror=alert(1)>', exit_code: 127, truncated: true,
  }
  let offline = true
  await page.exposeFunction('readToolCalls', (cursor?: string) => {
    if (cursor) {
      expect(cursor).toBe('older+page')
      if (offline) throw new Error('连接暂时中断')
      return { items: [past], next_cursor: null }
    }
    return { items: [current], next_cursor: 'older+page' }
  })
  await openMemory(page, () => ({ items: [], next_cursor: null }))
  await page.evaluate(() => Object.assign(window.wintermute!, {
    terminalToolHistory: (window as unknown as { readToolCalls: unknown }).readToolCalls,
  }))
  await page.getByRole('button', { name: '终端调用', exact: true }).click()
  const row = page.getByRole('article')
  await expect(row).toContainText('会议电脑')
  await expect(row).toContainText('shell')
  await expect(row).toContainText('hostname')
  await expect(row).toContainText('执行中')
  await row.getByText('执行详情').click()
  Object.assign(current, { status: 'succeeded', stdout: 'meeting-pc', exit_code: 0, completed_at: '2026-11-17T08:00:03Z' })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(row).toContainText('已成功')
  await expect(row.getByText('meeting-pc')).toBeVisible()
  await expect(row.locator('time').last()).toHaveAttribute('datetime', current.completed_at!)
  await page.getByRole('button', { name: '较早记录' }).click()
  await expect(page.getByRole('alert')).toContainText('连接暂时中断')
  offline = false
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(row).toContainText('另一台电脑')
  await row.getByText('执行详情').click()
  await expect(row.getByText('127')).toBeVisible()
  await expect(row.getByText(past.stderr)).toBeVisible()
  await expect(row.getByText('输出已截断')).toBeVisible()
  await expect(row.locator('img')).toHaveCount(0)
  await page.getByRole('button', { name: '较新记录' }).click()
  await expect(row).toContainText('meeting-pc')
})

test('six history views, paginated filtering and audio downloads', async ({
  page,
}) => {
  const file = { id: 'opaque-file-token', name: '会议录音.ogg' }
  const downloads: HistoryFile[] = []
  const reads: Query[] = []
  await openMemory(
    page,
    (query) => {
      reads.push(query)
      if (query.view === 'chat') {
        return query.cursor
          ? { items: [item('older', '会议改在三点')], next_cursor: null }
          : {
              items: [item('latest', '收到，附上新议程。', [file])],
              next_cursor: 'older-page',
            }
      }
      return {
        items:
          query.view === 'timeline'
            ? [
                item('text-and-media', '后端记录 timeline', [file]),
                item('media-only', '', [file]),
              ]
            : [item(query.view, '后端记录 ' + query.view)],
        next_cursor: null,
      }
    },
    (input) => {
      downloads.push(input)
      return { saved: downloads.length > 1 }
    },
  )
  const entry = page
    .getByRole('article')
    .filter({ hasText: '收到，附上新议程。' })
  await expect(entry).toContainText('用户原话 · 桌面')
  await expect(entry).toContainText('user')
  await expect(entry.locator('time')).toHaveAttribute(
    'datetime',
    '2026-11-14T09:15:00+08:00',
  )
  const attachment = page.getByRole('button', { name: file.name, exact: true })
  await expect(attachment).toBeVisible()
  await expect(
    entry.locator('a, img, audio, video, source, iframe, object'),
  ).toHaveCount(0)
  expect(downloads).toEqual([])
  await attachment.click()
  await expect(attachment).toBeEnabled()
  await expect(entry.getByText('已保存')).toHaveCount(0)
  await attachment.click()
  await expect(entry.getByText('已保存')).toBeVisible()
  expect(downloads).toEqual([file, file])
  await page.getByRole('textbox', { name: '筛选已加载记录' }).fill('三点')
  await expect(page.getByText('已加载的记录中没有匹配项')).toBeVisible()
  await page.getByRole('button', { name: '加载更早记录' }).click()
  await expect(page.getByText('会议改在三点')).toBeVisible()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await expect(page.getByRole('article')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '加载更早记录' })).toHaveCount(
    0,
  )
  expect(reads).toContainEqual({ view: 'chat', cursor: 'older-page' })
  for (const [label, view] of [
    ['合并线', 'timeline'],
    ['交流层', 'conversation'],
    ['通知层', 'notification'],
    ['感知层', 'perception'],
    ['切片层', 'slice'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    if (view === 'perception') await page.locator('.trace-toggle').click()
    await expect(page.getByText('后端记录 ' + view)).toBeVisible()
    if (view !== 'perception') await expect(page.getByRole('article')).toHaveCount(1)
    if (view === 'timeline') await expect(attachment).toHaveCount(0)
  }
})

test('keeps newer view on a late page and retries failed reads without losing older pages', async ({
  page,
}) => {
  let finishOldPage!: (result: HistoryPage) => void
  let rejectOlderPage = true
  let rejectRefresh = false
  await openMemory(page, (query) => {
    if (query.view === 'chat') {
      return query.cursor
        ? new Promise((resolve) => {
            finishOldPage = resolve
          })
        : { items: [item('chat', '会议安排')], next_cursor: 'older-chat' }
    }
    if (query.cursor && rejectOlderPage) throw new Error('读取较早记录失败')
    if (!query.cursor && rejectRefresh) throw new Error('刷新失败')
    return query.cursor
      ? {
          items: [
            { ...item('old', '会议开始'), occurred_at: null },
            item('older', '打开会议资料'),
          ],
          next_cursor: null,
        }
      : { items: [item('latest', '会议进行中')], next_cursor: 'older-activity' }
  })
  await page.getByRole('button', { name: '加载更早记录' }).click()
  await expect.poll(() => !!finishOldPage).toBe(true)
  await page.getByRole('button', { name: '合并线', exact: true }).click()
  await expect(page.getByText('会议进行中')).toBeVisible()
  finishOldPage({ items: [item('stale', '其他视图的记录')], next_cursor: null })
  await page.getByRole('button', { name: '加载更早记录' }).click()
  await expect(page.getByRole('alert')).toContainText('读取较早记录失败')
  await expect(page.getByText('会议进行中')).toBeVisible()
  await expect(page.getByText('其他视图的记录')).toHaveCount(0)
  rejectOlderPage = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByText('会议开始')).toBeVisible()
  await expect(
    page.getByRole('article').filter({ hasText: '会议开始' }),
  ).toContainText('时间未记录')
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(1)
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByText('会议开始')).toHaveCount(0)
  rejectRefresh = true
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('刷新失败')
  rejectRefresh = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('button', { name: '加载更早记录' })).toBeVisible()
  await expect(page.getByText('会议开始')).toHaveCount(0)
})

test('empty history and download errors are actionable', async ({ page }) => {
  await openMemory(
    page,
    ({ view }) => ({
      items:
        view === 'chat'
          ? []
          : [item('slice', '', [{ id: 'audio', name: '会议录音.ogg' }])],
      next_cursor: null,
    }),
    () => {
      throw new Error('文件已不存在')
    },
  )
  await expect(page.getByText('暂无记录')).toBeVisible()
  await page.getByRole('button', { name: '切片层', exact: true }).click()
  await page.getByRole('button', { name: '会议录音.ogg', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('文件已不存在')
  await expect(
    page.getByRole('button', { name: '会议录音.ogg', exact: true }),
  ).toBeEnabled()
})

test('groups screen captures and previews visible frames automatically', async ({
  page,
}) => {
  const group = {
    id: 'evt_run',
    app: 'QQ',
    subject: '家庭组邀请',
    frame_count: 3,
    change_count: 2,
    started_at: '2026-11-15T11:20:00+08:00',
    ended_at: '2026-11-15T11:30:00+08:00',
  }
  const reads: Query[] = []
  const downloads: HistoryFile[] = []
  let failPage = true
  await openMemory(
    page,
    (query) => {
      reads.push(query)
      if (query.view !== 'slice') return { items: [], next_cursor: null }
      if (!query.groupId)
        return {
          items: [
            {
              ...item('run', '对方询问开通会员。'),
              source: '切片 · android',
              group,
            },
            item('manual', '移动端截图', [
              { id: 'shared', name: '移动端.jpg' },
            ]),
          ],
          next_cursor: null,
        }
      if (!query.cursor)
        return {
          items: [
            item('two', '邀请已发出。', [{ id: 'two', name: 'capture-2.jpg' }]),
          ],
          next_cursor: 'next',
        }
      if (failPage) throw new Error('明细读取失败')
      return {
        items: [item('one', '', [{ id: 'one', name: 'capture-1.jpg' }])],
        next_cursor: null,
      }
    },
    (file) => {
      downloads.push(file)
      return { saved: true }
    },
  )
  await page.getByRole('button', { name: '切片层', exact: true }).click()
  const toggle = page.getByRole('button', { name: /QQ · 家庭组邀请/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('3 张截图')).toBeVisible()
  await expect(
    page.getByRole('img', { name: '移动端.jpg', exact: true }),
  ).toBeVisible()
  expect(reads.filter((q) => q.groupId)).toHaveLength(0)
  await toggle.click()
  await expect(page.getByText('邀请已发出。')).toBeVisible()
  await page.getByRole('button', { name: '更多截图' }).click()
  await expect(page.getByRole('alert')).toContainText('明细读取失败')
  failPage = false
  await page.getByRole('button', { name: '重试' }).click()
  await page.getByText('capture-1.jpg', { exact: true }).scrollIntoViewIfNeeded()
  const firstFile = page.getByRole('img', {
    name: 'capture-1.jpg',
    exact: true,
  })
  await expect(firstFile).toBeVisible()
  expect(downloads).toEqual([])
  await toggle.click()
  await expect(firstFile).toHaveCount(0)
  await page.getByRole('textbox', { name: '筛选已加载记录' }).fill('capture-1')
  await expect(page.getByText('移动端截图')).toHaveCount(0)
  await toggle.click()
  await expect(firstFile).toBeVisible()
  await expect(page.getByText('邀请已发出。')).toHaveCount(0)
  expect(downloads).toEqual([])
  expect(reads.filter((q) => q.groupId)).toEqual([
    { view: 'slice', groupId: 'evt_run' },
    { view: 'slice', groupId: 'evt_run', cursor: 'next' },
    { view: 'slice', groupId: 'evt_run', cursor: 'next' },
  ])
})

test('merged timeline expands grouped and single visits as compressed text only', async ({ page }) => {
  function visit(id: string, app: string, subject: string, start: string, end: string, seconds: number, device = 'http-desktop') {
    const at = '2026-11-18T' + end + 'Z'
    const text = at + ' | 感知 · ' + device + ' | ' + app + ' ' + start + '–' + end + ' ' + seconds
      + ' 秒\n内容：' + start + ' ' + subject + '\n设备：' + device
    return { ...item(id, text), occurred_at: at, source: '感知层 · ' + device, layer: 'perception' as const }
  }
  const records = [
    visit('one', 'ChatGPT', 'ChatGPT', '02:33:30', '02:34:06', 36.276),
    visit('two', 'ChatGPT', 'ChatGPT', '02:33:23', '02:33:29', 6.072),
    visit('three', 'ChatGPT', 'ChatGPT', '02:32:33', '02:32:39', 6.022),
    visit('four', 'chrome', 'GitHub', '02:32:08', '02:32:33', 14.089),
    visit('five', 'ChatGPT', '起草文档', '02:31:46', '02:32:08', 22.134),
    visit('six', 'ChatGPT', '另一台电脑上的对话', '02:31:12', '02:31:20', 8, 'laptop'),
    visit('seven', 'ChatGPT', '先前的对话', '02:25:12', '02:25:20', 8, 'laptop'),
  ]
  await openMemory(page, ({ view }) => ({ items: view === 'timeline' ? records : [], next_cursor: null }))
  await page.getByRole('button', { name: '合并线', exact: true }).click()
  const timeline = page.getByRole('region', { name: '活动时间轴' })
  const visits = timeline.getByRole('button', { expanded: false })
  await expect(visits).toHaveCount(5)
  const recent = timeline.getByRole('button', { name: /ChatGPT.*3 次 · 共 48 秒/ })
  await expect(recent).toBeVisible()
  await expect(recent).not.toContainText('http-desktop')
  await expect(timeline).not.toContainText('2026-11-18T')
  const localTime = await page.evaluate(iso => new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso)), records[0].occurred_at)
  await expect(recent.locator('time')).toHaveText(localTime)
  await recent.click()
  const texts = timeline.getByRole('group', {name:'压缩处理后的文本'})
  await expect(texts.locator('p')).toHaveCount(3)
  await expect(texts.locator('p').first()).toHaveText(records[0].text.split(' | ')[2])
  await expect(timeline.getByRole('button')).toHaveCount(5)
  await expect(timeline.locator('details, pre, .original-disclosure')).toHaveCount(0)
  await page.getByRole('textbox', {name:'筛选已加载记录'}).fill('GitHub')
  await expect(visits).toHaveCount(1)
  await expect(visits).toHaveAccessibleName(/Chrome.*GitHub.*14 秒/)
  await visits.click()
  await expect(texts).toHaveText(records[3].text.split(' | ')[2])
  await expect(timeline.getByRole('button')).toHaveCount(1)
})

test('slice captures keep their details and merged summaries expand as text only', async ({ page }) => {
  const at = '2026-11-15T11:00:00+08:00'
  await openMemory(page, ({ view }) => ({
    items: view === 'slice' ? [
      { ...item('audio', '预算要再核一次'), occurred_at: at, material_type: 'slice.audio', layer: 'slice', processing: 'ready' }
    ] : view === 'timeline' ? [
      { ...item('merged-1', '检查预算与方案'), members: [
        {id:'observed-1', terminal:'电脑', layer:'perception', occurred_at:at},
        {id:'captured-1', terminal:'录音机', layer:'slice', occurred_at:at},
      ]}
    ] : [], next_cursor: null
  }))
  await page.getByRole('button', {name:'切片层',exact:true}).click()
  await expect(page.getByRole('heading', {name:'活动时间轴'})).toBeVisible()
  await page.getByRole('button', {name:/预算要再核一次/}).click()
  await expect(page.getByRole('button', {name:'查看原始资料'})).toBeVisible()
  await expect(page.getByRole('button', {name:'压缩对照'})).toHaveCount(0)
  await page.getByRole('button',{name:'合并线',exact:true}).click()
  const summary=page.getByRole('button',{name:/检查预算与方案/})
  await summary.click()
  const timeline=page.getByRole('region',{name:'活动时间轴'})
  await expect(timeline.getByRole('group',{name:'压缩处理后的文本'})).toHaveText('检查预算与方案')
  await expect(timeline.getByRole('button')).toHaveCount(1)
  await summary.click()
  await expect(timeline.getByRole('group',{name:'压缩处理后的文本'})).toHaveCount(0)
})

test('AI summaries show the generation clock and the local interval of the summarized events', async ({ page }) => {
  // Use the browser time zone to construct the instants, including a midnight crossing.
  const [start, end, generated] = await page.evaluate(() =>
    ['2026-11-17T23:57:30', '2026-11-18T00:02:45', '2026-11-18T11:20:00']
      .map(value => new Date(value).toISOString()))
  const members = [{id:'visit', layer:'perception' as const, terminal:'电脑', occurred_at:end}]
  const meta = {kind:'ai' as const, generated_at:generated, covered_from:start, covered_until:end}
  await openMemory(page, ({view}) => ({
    items: view === 'timeline' ? [
      {...item('new-ai','整理待办'), occurred_at:generated, members, merged_summary:meta},
      {...item('visit','浏览文档'), occurred_at:end, layer:'perception'},
      {...item('old-ai','较早的摘要'), occurred_at:end, members, merged_summary:{...meta,generated_at:null}},
    ] : [], next_cursor:null,
  }))
  await page.getByRole('button',{name:'合并线',exact:true}).click()
  const rows=page.getByRole('region',{name:'活动时间轴'}).getByRole('button')
  await expect(rows.nth(0)).toContainText('AI 摘要')
  await expect(rows.nth(0).locator('time')).toHaveText('11:20')
  await expect(rows.nth(0)).toContainText(/覆盖 .*11月17日 23:57:30 – .*11月18日 00:02:45/)
  await expect(rows.nth(1)).toContainText('浏览文档')
  await expect(rows.nth(2)).toContainText('生成时间未记录')
  await rows.nth(0).click()
  await expect(page.getByRole('group',{name:'压缩处理后的文本'})).toHaveText('整理待办')
})

test('a visit separates original JSON and attachments, filter decisions and rule-compressed text', async ({page}) => {
  const start = '2026-11-15T09:00:00Z'
  const first = '2026-11-15T09:01:00Z'
  const second = '2026-11-15T09:02:00Z'
  const jpg = {id: 'evt_a:frame:0', name: 'first.jpg', occurred_at: first, content_type: 'image/jpeg'}
  const raw = {
    terminal_id: '会议电脑', event_id: 'evt_a', producer_event_id: 'local-a',
    payload: {state_key: 'desktop.window_span', value: {
      foreground_app: 'Editor', started_at: start, ended_at: second, duration_seconds: 90,
      work_objects: [{occurred_at: first, window_title: '议程文档'}],
      visual_observations: [{frame_index: 1, occurred_at: second, text: '风险清单出现两个待办。'}],
    }},
  }
  const previews: string[] = []
  let failPreview = true
  await openMemory(page, ({view}) => ({
    items: view === 'perception' ? [{ ...item('evt_a', '摘要', [jpg, {...jpg,id:'evt_a:frame:1',name:'second.jpg',occurred_at:second}]), raw }] : [],
    next_cursor: null,
  }), undefined, ({id, connectionRevision}) => {
    expect(connectionRevision).toBe(1)
    previews.push(id)
    if (failPreview && id === jpg.id) throw new Error('offline')
  })
  await page.evaluate(() => {
    const api = window.wintermute!
    Object.assign(api,{compression: async ({kind,id}: {kind:string;id:string}) => {
      if(kind!=='stages' || id!=='evt_a') throw Error('请求了其他记录')
      return { decisions:[{kind:'application',label:'Editor',seconds:90,kept:true},{kind:'title',label:'闪现标题',seconds:2,kept:false}],
        retained:{work_objects:['议程文档']},
        parts:[{kind:'observation',text:'会议电脑 · 议程文档',round_id:'1',delivered:false}],
        rounds:[{id:'1',status:'ready',input:'来自上一轮的摘要和本轮新增记录',summary:'已保存的模型摘要'}],
        ai_enabled:true, pending_size:50,budget:800 }
    }})
  })
  await page.getByRole('button', {name:'感知层',exact:true}).click()
  await page.getByRole('button',{name:/Editor/}).click()
  const detail = page.locator('.perception-stage')
  await expect(detail.getByRole('heading')).toHaveText(['原始信息','过滤处理','压缩处理'])
  await expect(detail.getByText('精简文本', { exact: true })).toBeVisible()
  await detail.getByText('原始 JSON',{exact:true}).click()
  await expect(detail.locator('.perception-json:visible')).toHaveText(JSON.stringify(raw,null,2))
  await detail.getByText('附件（2）',{exact:true}).click()
  await detail.getByRole('figure',{name:'first.jpg'}).scrollIntoViewIfNeeded()
  await expect(page.getByText('截图读取失败')).toBeVisible()
  failPreview = false
  await page.getByRole('button',{name:'重新加载截图'}).click()
  await expect(page.getByRole('img',{name:'first.jpg'})).toBeVisible()
  await detail.getByText('second.jpg').scrollIntoViewIfNeeded()
  await expect(detail.getByRole('img',{name:'second.jpg'})).toBeVisible()
  await expect(detail.getByText('风险清单出现两个待办。',{exact:true})).toBeVisible()
  await page.getByText('first.jpg', {exact: true}).scrollIntoViewIfNeeded()
  await expect(page.getByRole('img',{name:'first.jpg'})).toBeVisible()
  await expect(page.getByRole('row').filter({hasText:'闪现标题'})).toContainText('过滤')
  await expect(detail.getByRole('row')).toHaveCount(2)
  await expect(detail.getByText(/个短停留标题|应用或窗口标题停留/)).toHaveCount(0)
  await detail.getByText('查看过滤后保留的字段').click()
  await expect(detail.locator('section').nth(1).locator('pre')).toHaveText(JSON.stringify({work_objects:['议程文档']},null,2))
  await expect(page.getByText('会议电脑 · 议程文档')).toBeVisible()
  await expect(detail.getByText('已保存的模型摘要')).toHaveCount(0)
  await expect(detail.getByText('查看本轮完整输入')).toHaveCount(0)
  expect(previews).toContain('evt_a:frame:0')
  expect(previews).toContain('evt_a:frame:1')
})

test('stage selection follows the record and ignores late responses for another visit', async ({page}) => {
  const rows = ['Editor','QQ'].map((app,i)=>({...item(app,app),filter_result:i?'filtered':'kept',raw:{payload:{
    state_key:'desktop.window_span',value:{foreground_app:app,duration_seconds:i?5:30}}}}))
  await openMemory(page,()=>({items:rows,next_cursor:null}))
  let release!: () => void
  const gate = new Promise<void>(resolve=> { release=resolve })
  let finished=false
  await page.exposeFunction('readStages',async ({id}:{id:string})=>{
    if(id==='Editor') await gate
    const kept=id==='Editor'
    return { dwell_threshold_seconds:5, decisions:[{kind:'application',label:id,seconds:kept?30:5,kept}],retained:kept?{app:id}:null,
      parts:[{kind:'observation',text:kept?'编辑记录':'',delivered:false,round_id:null},
        ...(kept&&finished?[{kind:'visual',text:'截图识别返回的规则文本',delivered:false,round_id:null}]:[])],
      rounds:[],
      ai_enabled:true,pending_size:75,budget:800 }
  })
  await page.evaluate(()=>Object.assign(window.wintermute!,{compression:(window as unknown as {readStages:unknown}).readStages}))
  await page.getByRole('button',{name:'感知层',exact:true}).click()
  await page.getByRole('button',{name:/Editor/}).click()
  await expect(page.getByText('正在读取处理记录…')).toBeVisible()
  const list=page.getByRole('list',{name:'采集记录'})
  await list.getByRole('button',{name:/QQ/}).click()
  await expect(page.getByText('整次停留已过滤')).toBeVisible()
  const filter=page.getByRole('combobox',{name:'按过滤结果筛选'})
  await filter.selectOption('filtered')
  await expect(list.locator('.trace-toggle')).toHaveCount(1)
  await list.getByRole('button',{name:/QQ/}).click()
  await expect(page.getByText('整次停留已过滤')).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
  await filter.selectOption('partial')
  await expect(page.getByRole('status')).toContainText('没有符合此筛选条件')
  await filter.selectOption('filtered')
  release()
  await list.getByRole('button',{name:/QQ/}).click()
  await expect(page.getByText('整条记录已过滤。', { exact: true })).toBeVisible()
  await filter.selectOption('all')
  await list.getByRole('button',{name:/Editor/}).click()
  await expect(page.getByText('编辑记录',{exact:true})).toBeVisible()
  finished=true
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await expect(page.getByText('截图识别返回的规则文本')).toBeVisible()
})

test('fixed Wintermute exclusions show zero tokens and undated observations sort after older days', async ({page}) => {
  const events = [
    {...item('undated',''),occurred_at:null,raw:{payload:{state_key:'undated'}}},
    {...item('epoch',''),occurred_at:'1970-01-01T00:00:00Z',raw:{payload:{state_key:'epoch'}}},
    {...item('self',''),filter_result:'filtered' as const,
      usage:{tokens:0,budget:800,devices:['pc'],duration_seconds:120},
      raw:{payload:{state_key:'desktop.window_span',value:{foreground_app:'Wintermute'}}}},
  ]
  await openMemory(page,()=>({items:events,next_cursor:null}))
  await page.evaluate(()=>Object.assign(window.wintermute!,{compression:async()=>({
    filter_reason:'wintermute_app',decisions:[],parts:[],rounds:[],retained:null
  })}))
  await page.getByRole('button',{name:'感知层',exact:true}).click()
  await expect(page.locator('.trace-title strong')).toHaveText(['Wintermute','epoch','undated'])
  await expect(page.locator('.trace-budget').first()).toHaveText('约 0 tokens')
  await page.locator('.trace-toggle').first().click()
  await expect(page.getByText('Wintermute 自身活动固定整条过滤。')).toBeVisible()
  await expect(page.getByText('整条记录已过滤。', { exact: true })).toBeVisible()
})

test('a visit opens the stored message and follows a peer outside the loaded page', async ({page}) => {
  const ref = {id:'history-4-1',written_at:'2026-11-17T10:00:00Z',
    usage:{tokens:119,budget:800,devices:['desktop'],duration_seconds:120}}
  const visit = (app:string,at:string) => ({
    ...item(app,app), occurred_at:at, context_messages:[ref], raw:{payload:{state_key:'desktop.window_span',
      value:{foreground_app:app,started_at:at,duration_seconds:60,window_title:app+'.md'}}}
  })
  const first = visit('Editor','2026-11-17T09:30:00Z')
  const peer = visit('Chrome','2026-11-17T08:45:00Z')
  const original = '…\n只节选了最近的工作对象。\n\n---\n来源：活动时间线\n时间：2026-11-17T09:31:00Z'
  await openMemory(page,({view})=>({items:view==='perception'?[first]:[],next_cursor:null}))
  const lookup:string[]=[]
  await page.exposeFunction('traceFixture',({kind,id,record}:{kind:string;id:string;record?:boolean})=>{
    if(kind==='trace'){
      expect(id).toBe(ref.id)
      return {text:original,written_at:ref.written_at,next_cursor:null,items:[first,peer].map(v=>({
        id:v.id,event_id:v.id,occurred_at:v.occurred_at,terminal:'desktop',title:v.id
      }))}
    }
    if(record) lookup.push(id)
    return {record:record?peer:undefined,context_messages:[ref],decisions:[],retained:{},
      parts:[{kind:'observation',text:'保留的规则文字',delivered:true,round_id:null}],
      rounds:[],ai_enabled:true,budget:800,pending_size:0}
  })
  await page.evaluate(()=>Object.assign(window.wintermute!,{compression:(window as unknown as {traceFixture:unknown}).traceFixture}))
  await page.getByRole('button',{name:'感知层',exact:true}).click()
  await expect(page.locator('.trace-title strong')).toHaveText(['时间线消息写入上下文','Editor'])
  await expect(page.locator('.trace-toggle[data-kind="message"] .trace-budget')).toHaveText('约 119 tokens')
  await expect(page.locator('.trace-toggle[data-kind="message"] small')).toHaveText('来源设备 desktop · 使用时长 2 分钟')
  await page.locator('.trace-toggle[data-kind="visit"]').click()
  await expect(page.locator('.perception-stage pre.stage-text')).toHaveText('保留的规则文字')
  await expect(page.locator('.perception-stage .trace-group')).toHaveCount(0)
  await page.getByRole('button',{name:/查看上下文原文/}).click()
  await expect(page.locator('.trace-group pre')).toHaveText(original)
  await page.getByRole('button',{name:/Chrome ↗/}).click()
  await expect(page.locator('.trace-toggle[aria-expanded=true]')).toContainText('Chrome')
  await page.getByText('原始 JSON',{exact:true}).click()
  await expect(page.locator('.perception-json:visible')).toContainText('Chrome.md')
  await expect(page.locator('.trace-title strong')).toHaveText(['时间线消息写入上下文','Editor','Chrome'])
  expect(lookup).toContain(peer.id)
  await page.getByRole('button',{name:/查看上下文原文/}).click()
  await expect(page.locator('.trace-toggle[aria-expanded=true]')).toContainText('时间线消息写入上下文')
  await expect(page.locator('.trace-group pre')).toHaveText(original)
  await page.getByRole('button',{name:/Editor ↗/}).click()
  await expect(page.locator('.trace-toggle[aria-expanded=true]')).toContainText('Editor')
})

test('a completed AI round appears on refresh and links back to its source before context delivery', async ({page}) => {
  const time = '2026-11-17T09:15:00Z'
  const usage = {tokens:45,tokenizer:'deepseek-v4' as const,budget:300,devices:['pc','mobile'],duration_seconds:66}
  const ref = {id:'round-8',occurred_at:time,generated_at:time,usage}
  const earlier = {id:'round-3',occurred_at:'2026-11-17T08:00:00Z',generated_at:null,
    usage:{...usage,devices:['mobile'],duration_seconds:51}}
  const summary = '先查看清单，随后打开部署文档。'.repeat(100) + '\n完整摘要的最后一行。'
  const input = '09:10 清单；09:12 部署文档。'
  const visit = {...item('evt_a','清单'),occurred_at:'2026-11-17T09:10:00Z',
    usage:{tokens:37,budget:800,devices:['pc'],duration_seconds:15},
    raw:{payload:{state_key:'desktop.window_span',value:{foreground_app:'Editor',duration_seconds:15}}}}
  const marker = {...item(ref.id,summary),occurred_at:time,source:'AI 摘要',summary_round:ref}
  let ready = false
  await openMemory(page,({view})=>({items:view==='perception'?(ready?[marker,visit]:[visit]):[],next_cursor:null}))
  await page.exposeFunction('summaryFixture',({kind,id}:{kind:string;id:string})=>{
    if(kind==='trace'){
      if(id===earlier.id) return {round:{input:'早先的活动',summary:'先前的摘要',previous_summary:null},
        text:null,written_at:null,next_cursor:null,items:[]}
      expect(id).toBe(ref.id)
      return {round:{input,summary,previous_summary:earlier},text:null,written_at:null,next_cursor:null,
        items:[{id:visit.id,event_id:visit.id,title:'Editor',occurred_at:visit.occurred_at,terminal:'pc'}]}
    }
    expect(id).toBe(visit.id)
    return {context_messages:[],parts:[{kind:'observation',text:input,round_id:'8',delivered:false}],
      retained:{},decisions:[],ai_enabled:true,pending_size:0,budget:800,
      rounds:[{id:'8',status:'ready',input,summary,timeline_entry:ref}]}
  })
  await page.evaluate(()=>Object.assign(window.wintermute!,{compression:(window as unknown as {summaryFixture:unknown}).summaryFixture}))
  await page.getByRole('button',{name:'感知层',exact:true}).click()
  await expect(page.locator('.trace-title strong')).toHaveText(['Editor'])
  ready = true
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.trace-title strong')).toHaveText(['AI 摘要','Editor'])
  await expect(page.locator('.trace-budget')).toHaveText(['45 tokens','约 37 tokens'])
  await expect(page.locator('.trace-title small')).toHaveText([
    '来源设备 pc、mobile · 使用时长 1 分钟 6 秒','来源设备 pc · 使用时长 15 秒'])
  await page.locator('.trace-toggle[data-kind="summary"]').click()
  await expect(page.locator('.trace-detail').getByText(summary,{exact:true})).toBeVisible()
  await page.getByText('查看本轮完整输入',{exact:true}).click()
  await expect(page.getByText(input,{exact:true})).toBeVisible()
  await page.getByRole('button',{name:/上一轮 AI 摘要/}).click()
  await expect(page.locator('.trace-detail').getByText('先前的摘要',{exact:true})).toBeVisible()
  await expect(page.locator('.trace-toggle[aria-expanded=true] small')).toHaveText('来源设备 mobile · 使用时长 51 秒')
  await page.locator('#perception-row-round-8').click()
  await page.getByRole('button',{name:/Editor ↗/}).click()
  await expect(page.locator('.trace-toggle[aria-expanded=true]')).toContainText('Editor')
  await page.getByRole('button',{name:/查看关联摘要/}).click()
  await expect(page.locator('.trace-toggle[aria-expanded=true]')).toContainText('AI 摘要')
  await expect(page.locator('.trace-toggle[data-kind="message"]')).toHaveCount(0)
})

test('a pending attachment on an older page gains its description', async ({page}) => {
  const shot = '2026-11-17T09:01:00Z'
  const end = '2026-11-17T09:02:00Z'
  const file = {id:'visit:frame:0', name:'meeting.jpg', occurred_at:shot, content_type:'image/jpeg'}
  let ready = false
  await openMemory(page, ({view, cursor}) => {
    if (view !== 'perception') return {items:[], next_cursor:null}
    if (!cursor) return {items:[item('newer','另一条感知')],next_cursor:'older'}
    return {items:[{...item('visit','桌面停留',[file]),raw:{payload:{
      state_key:'desktop.window_span',image_recognition:ready?'ready':'pending',frames:[file],
      value:{foreground_app:'编辑器',started_at:'2026-11-17T09:00:00Z',ended_at:end,
        work_objects:[{occurred_at:end,window_title:'风险清单'}],
        visual_observations:ready?[{frame_index:0,occurred_at:shot,text:'议程里写着部署评审'}]:[]},
    }}}],next_cursor:null}
  })
  await page.getByRole('button',{name:'感知层',exact:true}).click()
  await page.getByRole('button',{name:'加载更早记录'}).click()
  await page.getByRole('list',{name:'采集记录'}).getByRole('button',{name:/编辑器/}).click()
  await page.getByText('附件（1）',{exact:true}).click()
  await expect(page.getByText(/正在识别截图/)).toBeVisible()
  ready = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText('议程里写着部署评审',{exact:true})).toBeVisible()
  await expect(page.getByText(/正在识别截图/)).toHaveCount(0)
  await page.getByText('原始 JSON',{exact:true}).click()
  await expect(page.locator('.perception-json')).toContainText('议程里写着部署评审')
})

test('screenshot reads follow the viewport and release image URLs when leaving memory', async ({ page }) => {
  const reads: string[] = []
  const rows = Array.from({length: 20}, (_, i) =>
    item('event-' + i, '已完成的前台停留', [{id:'frame-' + i, name:'窗口-' + i + '.jpg'}]),
  )
  await openMemory(page, ({view}) => ({
    items: view === 'perception' ? rows : [], next_cursor: null,
  }), undefined, ({id}) => { reads.push(id) })
  const released: string[] = []
  await page.exposeFunction('recordRelease', (url: string) => released.push(url))
  await page.evaluate(() => {
    const original = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (url) => {
      original(url)
      void (window as unknown as {recordRelease: (url: string) => Promise<void>}).recordRelease(url)
    }
  })
  await page.getByRole('button',{name:'感知层',exact:true}).click()
  await page.locator('.trace-toggle').first().click()
  await page.getByText('附件（1）',{exact:true}).click()
  const first = page.getByRole('img',{name:'窗口-0.jpg',exact:true})
  await expect(first).toBeVisible()
  const url = await first.getAttribute('src')
  expect(reads).not.toContain('frame-19')
  await page.locator('.trace-toggle').last().click()
  await page.getByText('附件（1）',{exact:true}).click()
  await page.getByRole('figure',{name:'窗口-19.jpg'}).scrollIntoViewIfNeeded()
  await expect(page.getByRole('img',{name:'窗口-19.jpg',exact:true})).toBeVisible()
  await expect(first).toHaveCount(0)
  await expect.poll(() => released).toContain(url)
  const lastUrl = await page.getByRole('img',{name:'窗口-19.jpg'}).getAttribute('src')
  await page.getByRole('button',{name:'切片层',exact:true}).click()
  await expect.poll(() => released).toContain(lastUrl)
})

test('the open chat journal refreshes on return and reflects a database reset', async ({page}) => {
  let rows = [item('old','旧记录')]
  await openMemory(page, () => ({items:rows, next_cursor:null}))
  await expect(page.getByText('旧记录')).toBeVisible()
  rows = [item('new','提醒回复'), ...rows]
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText('提醒回复')).toBeVisible()
  rows = []
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText('暂无记录')).toBeVisible()
  await expect(page.getByText('旧记录')).toHaveCount(0)
})
