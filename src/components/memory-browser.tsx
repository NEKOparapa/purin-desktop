import { useEffect, useState } from 'react'
import { BookOpen, ChevronRight, Plug, RotateCw, Search, X } from 'lucide-react'
import type { ActivityLayer, HistoryItem, HistoryView } from '@/lib/desktop'
import { emptyPage, useHistoryPages, type PageState } from '@/lib/history-pages'
import { Files } from './history-files'
import { HistoryConnection } from './history-viewport'
import { PerceptionRecord, type PerceptionMode } from './perception-record'
import { CompressionBrowser, OriginalDisclosure } from './compression-browser'
import { UserProfile } from './user-profile'
import './memory-browser.css'

const views: { id: HistoryView | 'profile'; label: string }[] = [
  { id: 'chat', label: '对话历史' },
  { id: 'timeline', label: '时间线历史' },
  { id: 'conversation', label: '交流层' },
  { id: 'notification', label: '通知层' },
  { id: 'perception', label: '感知层' },
  { id: 'slice', label: '切片层' },
  { id: 'profile', label: '用户档案' },
]
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' })
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  timeStyle: 'medium',
  hour12: false,
})

function matches(item: HistoryItem, term: string) {
  return [
    item.text,
    item.source,
    item.role,
    item.raw && JSON.stringify(item.raw),
    item.group?.app,
    item.group?.subject,
    ...item.files.map((f) => f.name),
  ].some((field) => field?.toLowerCase().includes(term))
}

function PageActions({
  page,
  load,
  moreLabel,
}: {
  page: PageState
  load: (cursor: string | null) => void
  moreLabel: string
}) {
  return (
    <>
      {page.error && (
        <p className="history-error history-status" role="alert">
          {page.error}
        </p>
      )}
      <div className="history-actions">
        {page.loading ? (
          <p role="status">正在读取记录…</p>
        ) : page.error ? (
          <button onClick={() => load(page.requested)}>重试</button>
        ) : (
          page.next && (
            <button onClick={() => load(page.next)}>{moreLabel}</button>
          )
        )}
      </div>
    </>
  )
}

function groupTime(start: string, end: string) {
  const from = new Date(start),
    to = new Date(end)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()))
    return ''
  const first = timeFormat.format(from),
    last = timeFormat.format(to)
  if (dateFormat.format(from) !== dateFormat.format(to))
    return (
      dateFormat.format(from) +
      ' ' +
      first +
      ' – ' +
      dateFormat.format(to) +
      ' ' +
      last
    )
  return first === last ? first : first + ' – ' + last
}

function GroupRecord({
  item,
  pages,
  read,
  term,
}: {
  item: HistoryItem
  term: string
} & ReturnType<typeof useHistoryPages>) {
  const group = item.group!
  const [expanded, setExpanded] = useState(false)
  const page = pages.get(group.id)
  useEffect(() => {
    if (expanded && !page) void read(group.id, null)
  }, [expanded, page, read, group.id])
  const frames = page?.items ?? []
  const visible =
    term && !matches(item, term)
      ? frames.filter((frame) => matches(frame, term))
      : frames
  const title =
    [...new Set([group.app, group.subject].filter(Boolean))].join(' · ') ||
    '定时截图'
  return (
    <article className="history-entry history-group">
      <button
        className="history-group-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <ChevronRight size={16} aria-hidden="true" />
        <strong>{title}</strong>
        <span className="history-group-time">
          {groupTime(group.started_at, group.ended_at)}
        </span>
      </button>
      <div className="history-group-body">
        {item.text && <p>{item.text}</p>}
        <div className="history-group-meta">
          <span>{group.frame_count} 张截图</span>
          <span>{group.change_count} 次更新</span>
          <span>{item.source}</span>
        </div>
      </div>
      {expanded && (
        <div className="history-group-details">
          <ol className="history-frames" aria-label="截图明细">
            {visible.map((frame) => (
              <li key={frame.id}>
                {frame.occurred_at && (
                  <time dateTime={frame.occurred_at}>
                    {groupTime(frame.occurred_at, frame.occurred_at)}
                  </time>
                )}
                {frame.text && <p>{frame.text}</p>}
                <Files files={frame.files} />
                <OriginalDisclosure id={frame.id} layer="slice" />
              </li>
            ))}
          </ol>
          {page && (
            <PageActions
              page={page}
              load={(cursor) => void read(group.id, cursor)}
              moreLabel="更多截图"
            />
          )}
        </div>
      )}
    </article>
  )
}

function HistoryRecords({
  items,
  pages,
  read,
  term,
  layer,
  raw,
}: {
  items: HistoryItem[]
  term: string
  layer?: ActivityLayer
  raw: boolean
} & ReturnType<typeof useHistoryPages>) {
  const rows = []
  let previousDay: string | null = null
  for (const item of items) {
    const stamp = item.occurred_at && new Date(item.occurred_at)
    const date = stamp && Number.isFinite(stamp.getTime()) ? stamp : null
    const day = date ? dateFormat.format(date) : null
    rows.push({ item, date, heading: day !== previousDay ? day : null })
    if (day) previousDay = day
  }
  return (
    <ol className="history-records">
      {rows.map(({ item, date, heading }) => (
        <li key={item.id}>
          {heading && <h2>{heading}</h2>}
          {layer === 'perception' ? (
            <PerceptionRecord item={item} raw={raw} />
          ) : item.group ? (
            <GroupRecord item={item} pages={pages} read={read} term={term} />
          ) : (
            <article className="history-entry">
              <header>
                <strong>{item.source}</strong>
                <span className="history-role" aria-label={'角色 ' + item.role}>
                  {item.role}
                </span>
                {date ? (
                  <time dateTime={item.occurred_at ?? undefined}>
                    {timeFormat.format(date)}
                  </time>
                ) : (
                  <span className="history-unknown-time">时间未记录</span>
                )}
              </header>
              {item.text && <p>{item.text}</p>}
              <Files files={item.files} />
              {layer && <OriginalDisclosure id={item.id} layer={layer} />}
            </article>
          )}
        </li>
      ))}
    </ol>
  )
}

function HistoryList({
  view,
  label,
  raw = false,
}: {
  view: HistoryView
  label: string
  raw?: boolean
}) {
  const { pages, read } = useHistoryPages(view)
  const page = pages.get(null) ?? emptyPage
  const [query, setQuery] = useState('')
  const term = query.trim().toLowerCase()
  const visible = page.items.filter(
    (item) =>
      !term ||
      matches(item, term) ||
      (item.group &&
        pages.get(item.group.id)?.items.some((frame) => matches(frame, term))),
  )
  return (
    <section aria-label={label} className="history-list">
      <div className="history-tools">
        <label className="history-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="筛选已加载记录"
            placeholder="筛选已加载记录"
          />
          {query && (
            <button aria-label="清除筛选" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </label>
        <button
          className="history-refresh"
          onClick={() => void read(null, null)}
          disabled={page.loading}
        >
          <RotateCw size={14} aria-hidden="true" /> 刷新
        </button>
      </div>
      <HistoryRecords
        items={visible}
        pages={pages}
        read={read}
        term={term}
        layer={view === 'slice' || view === 'perception' ? view : undefined}
        raw={raw}
      />
      {!page.loading && !page.error && !visible.length && (
        <div className="history-empty" role="status">
          <BookOpen size={22} aria-hidden="true" />
          {term ? '已加载的记录中没有匹配项' : '暂无记录'}
        </div>
      )}
      <PageActions
        page={page}
        load={(cursor) => void read(null, cursor)}
        moreLabel="加载更早记录"
      />
    </section>
  )
}

function ActivityHistory({
  layer,
  label,
  openTimeline,
}: {
  layer: ActivityLayer
  label: string
  openTimeline: () => void
}) {
  const [compare, setCompare] = useState(false)
  const [mode, setMode] = useState<PerceptionMode>('formatted')
  if (layer === 'perception')
    return (
      <>
        <div className="history-modes" role="group" aria-label="感知层显示方式">
          {(
            [
              ['formatted', '格式化信息'],
              ['raw', '原始信息'],
              ['compressed', '压缩信息'],
            ] as const
          ).map(([id, title]) => (
            <button
              key={id}
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
            >
              {title}
            </button>
          ))}
        </div>
        {mode === 'compressed' ? (
          <CompressionBrowser layer={layer} openTimeline={openTimeline} />
        ) : (
          <HistoryList view={layer} label={label} raw={mode === 'raw'} />
        )}
      </>
    )
  return (
    <>
      <div
        className="history-modes"
        role="group"
        aria-label={label + '显示方式'}
      >
        <button aria-pressed={!compare} onClick={() => setCompare(false)}>
          记录
        </button>
        <button aria-pressed={compare} onClick={() => setCompare(true)}>
          压缩对照
        </button>
      </div>
      {compare ? (
        <CompressionBrowser layer={layer} openTimeline={openTimeline} />
      ) : (
        <HistoryList view={layer} label={label} />
      )}
    </>
  )
}

export function MemoryBrowser({
  connectionKey,
  connectionRevision,
  connected,
  settings,
}: {
  connectionKey: string
  connectionRevision?: number
  connected: boolean
  settings: () => void
}) {
  const [view, setView] = useState(views[0])
  return (
    <HistoryConnection.Provider value={connectionRevision}>
      <section className="browse-page history-browser">
        <div className="page-heading">
          <h1>记忆</h1>
        </div>
        <div className="history-views" role="group" aria-label="历史视图">
          {views.map((v) => (
            <button
              key={v.id}
              aria-pressed={view.id === v.id}
              onClick={() => setView(v)}
            >
              {v.label}
            </button>
          ))}
        </div>
        {connected ? (
          view.id === 'profile' ? (
            <UserProfile key={connectionKey} />
          ) : view.id === 'slice' || view.id === 'perception' ? (
            <ActivityHistory
              key={connectionKey + view.id}
              layer={view.id}
              label={view.label}
              openTimeline={() =>
                setView(views.find((v) => v.id === 'timeline')!)
              }
            />
          ) : (
            <HistoryList
              key={connectionKey + view.id}
              view={view.id}
              label={view.label}
            />
          )
        ) : (
          <div className="history-empty">
            <Plug size={22} aria-hidden="true" />
            <p>
              {view.id === 'profile'
                ? '连接后可查看用户档案'
                : '连接后可浏览后端历史记录'}
            </p>
            <button onClick={settings}>连接设置</button>
          </div>
        )}
      </section>
    </HistoryConnection.Provider>
  )
}
