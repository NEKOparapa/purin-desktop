import { test, expect, type Page } from '@playwright/test'
import type { HistoryFile, HistoryPage, HistoryView } from '../src/lib/desktop'

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
    ['时间线历史', 'timeline'],
    ['交流层', 'conversation'],
    ['通知层', 'notification'],
    ['感知层', 'perception'],
    ['切片层', 'slice'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByText('后端记录 ' + view)).toBeVisible()
    await expect(page.getByRole('article')).toHaveCount(1)
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
  await page.getByRole('button', { name: '时间线历史', exact: true }).click()
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

test('compares the same batch with its persisted summaries and opens scoped originals lazily', async ({
  page,
}) => {
  const calls: {
    kind: string
    id?: string
    layer?: string
    cursor?: string
    activity?: boolean
  }[] = []
  const downloads: HistoryFile[] = []
  const at = '2026-11-15T11:00:00+08:00'
  const batch = {
    id: '17',
    terminal_id: '会议电脑',
    started_at: at,
    ended_at: at,
    perception_count: 1,
    slice_count: 1,
    status: 'ready',
    partial: false,
  }
  const input = {
    id: 'obs',
    layer: 'slice',
    occurred_at: at,
    source: '切片 · 会议电脑',
    text: '截图上出现“发送成功”',
    source_count: 1,
  }
  const file = { id: 'shot', name: '会议窗口.jpg' }
  const data = ({ id }: { id?: string }) => ({
    items: [
      {
        id: 'shot',
        kind: 'slice.image',
        occurred_at: at,
        source: '截图',
        payload: { title: '发布会议', app: 'QQ' },
        transcript: null,
        files: [file],
      },
    ],
    next_cursor: null,
    extraction: {
      status: 'ready',
      text: id === 'obs' ? '已提取的图像事实' : '直接从记录读取的事实',
      strategy: 'image_description',
      source_count: 1,
    },
  })
  await openMemory(
    page,
    ({ view }) => ({
      items: view === 'slice' ? [item('event', '原始切片')] : [],
      next_cursor: null,
    }),
    (f) => {
      downloads.push(f)
      return { saved: true }
    },
  )
  await page.exposeFunction('inspectFixture', (q: (typeof calls)[number]) => {
    calls.push(q)
    if (q.kind === 'list')
      return {
        items: [q.cursor ? { ...batch, id: '18', partial: true } : batch],
        next_cursor: q.cursor ? null : 'more-batches',
      }
    if (q.kind === 'source') return data(q)
    return {
      batch: q.id === '18' ? { ...batch, id: '18', partial: true } : batch,
      rule_text: q.id === '18' ? null : '规则合计 90 秒',
      ai_text: q.id === '18' ? null : 'AI 归纳了会议进展',
      rollup: {
        status: 'ready',
        rule_text: '多批规则',
        ai_text: '跨批会议总览',
      },
      items: [
        q.cursor ? { ...input, id: 'obs2', text: '后续打开了会议清单' } : input,
      ],
      next_cursor: q.cursor ? null : 'more-inputs',
    }
  })
  await page.evaluate(() => {
    const api = window as unknown as {
      wintermute: Record<string, unknown>
      inspectFixture: unknown
    }
    api.wintermute.compression = api.inspectFixture
  })
  await page.getByRole('button', { name: '切片层', exact: true }).click()
  await page.getByRole('button', { name: '查看原始资料' }).click()
  await expect(page.getByText('直接从记录读取的事实')).toBeVisible()
  await page.getByRole('button', { name: '压缩对照', exact: true }).click()
  await expect(page.getByRole('button', { name: /会议电脑/ })).toBeVisible()
  expect(calls.filter((q) => q.kind === 'batch')).toHaveLength(0)
  await page.getByRole('button', { name: /会议电脑/ }).click()
  await expect(page.getByText('规则合计 90 秒')).toBeVisible()
  await expect(page.getByText('AI 归纳了会议进展')).toBeVisible()
  await page.getByText('跨批次汇总', { exact: true }).click()
  await expect(page.getByText('跨批会议总览')).toBeVisible()
  await page.getByRole('button', { name: '查看原始资料' }).click()
  await expect(page.locator('pre')).toContainText('发布会议')
  await expect(page.getByText('已提取的图像事实')).toBeVisible()
  expect(calls).toContainEqual({ kind: 'source', id: 'obs', activity: true })
  expect(downloads).toEqual([])
  await page.getByText('会议窗口.jpg', { exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('img', { name: '会议窗口.jpg' })).toBeVisible()
  expect(downloads).toEqual([])
  await page.getByRole('button', { name: '加载更多活动输入' }).click()
  await expect(page.getByText('后续打开了会议清单')).toBeVisible()
  await page.getByRole('button', { name: '加载更早批次' }).click()
  await page.getByRole('button', { name: /部分可见/ }).click()
  await expect(page.getByText(/此批次仅部分记录/)).toBeVisible()
  await expect(page.getByText('跨批次汇总')).toHaveCount(0)
  await page.getByRole('button', { name: '查看已投递的时间线' }).click()
  await expect(
    page.getByRole('button', { name: '时间线历史', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('perception shows the complete event, ordered observations with inline frames, and stored summaries', async ({page}) => {
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
    Object.assign(api,{compression: async ({kind}: {kind:string}) => {
      const batch = {id:'1', terminal_id:'会议电脑', started_at:'2026-11-15T09:00:00Z', ended_at:'2026-11-15T09:02:00Z', perception_count:1,slice_count:0,status:'ready',partial:false}
      return kind === 'list' ? {items:[batch],next_cursor:null}
        : {batch,items:[],next_cursor:null,rule_text:'规则结果',ai_text:'已保存的模型摘要',rollup:null}
    }})
  })
  await page.getByRole('button', {name:'感知层',exact:true}).click()
  await expect(page.getByRole('button', {name:'格式化信息'})).toHaveAttribute('aria-pressed','true')
  await expect(page.getByRole('heading', {name:'Editor'})).toBeVisible()
  await expect(page.getByText('停留 1 分钟 30 秒')).toBeVisible()
  await expect(page.getByText('议程文档')).toBeVisible()
  await expect(page.getByText('截图读取失败')).toBeVisible()
  failPreview = false
  await page.getByRole('button',{name:'重新加载截图'}).click()
  await expect(page.getByRole('img',{name:'first.jpg'})).toBeVisible()
  const description=page.locator('li').filter({has:page.getByText('风险清单出现两个待办。',{exact:true})}).last()
  await description.getByText('second.jpg').scrollIntoViewIfNeeded()
  await expect(description.getByRole('img',{name:'second.jpg'})).toBeVisible()
  await page.getByRole('button',{name:'原始信息'}).click()
  await expect(page.locator('.perception-json')).toHaveText(JSON.stringify(raw,null,2))
  await page.getByText('first.jpg', {exact: true}).scrollIntoViewIfNeeded()
  await expect(page.getByRole('img',{name:'first.jpg'})).toBeVisible()
  await page.getByRole('button',{name:'压缩信息'}).click()
  await page.getByRole('button',{name:/会议电脑/}).click()
  await expect(page.getByText('规则结果')).toBeVisible()
  await expect(page.getByText('已保存的模型摘要')).toBeVisible()
  await expect(page.getByRole('img')).toHaveCount(0)
  expect(previews).toContain('evt_a:frame:0')
  expect(previews).toContain('evt_a:frame:1')
})

test('a pending visit on an older page gains its description in capture order', async ({page}) => {
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
  await expect(page.getByText(/正在识别截图/)).toBeVisible()
  ready = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const entries = page.locator('.perception-details > ol > li')
  await expect(entries).toHaveCount(2)
  await expect(entries.nth(0)).toContainText('议程里写着部署评审')
  await expect(entries.nth(1)).toContainText('风险清单')
  await expect(page.getByText(/正在识别截图/)).toHaveCount(0)
  await page.getByRole('button',{name:'原始信息'}).click()
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
  const first = page.getByRole('img',{name:'窗口-0.jpg',exact:true})
  await expect(first).toBeVisible()
  const url = await first.getAttribute('src')
  expect(reads).not.toContain('frame-19')
  await page.getByText('窗口-19.jpg',{exact:true}).scrollIntoViewIfNeeded()
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
