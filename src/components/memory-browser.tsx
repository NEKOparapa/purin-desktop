import { useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  Cpu,
  Plug,
  RotateCw,
  Search,
  X,
} from 'lucide-react'
import type {
  ActivityLayer,
  ContextPreview,
  HistoryItem,
  HistoryView,
  PerceptionDestinationFilter,
} from '@/lib/desktop'
import {
  emptyPage,
  useHistoryPages,
  type HistoryFilter,
  type PageState,
} from '@/lib/history-pages'
import { Files } from './history-files'
import { HistoryConnection } from './history-viewport'
import { PerceptionBrowser } from './perception-browser'
import { CompressionBrowser, OriginalDisclosure } from './compression-browser'
import { UserProfile } from './user-profile'
import { TerminalToolHistory } from './terminal-tool-history'
import { ContextPreviewPanel, FlowOverview } from './flow-overview'
import { TimelineSources } from './timeline-sources'
import './memory-browser.css'

type MemoryViewId = HistoryView | 'overview' | 'profile' | 'terminal-tools'

interface MemoryViewOption {
  id: MemoryViewId
  label: string
}

const viewGroups: { group: string; items: MemoryViewOption[] }[] = [
  {
    group: '数据流',
    items: [
      { id: 'overview', label: '总览' },
      { id: 'perception', label: '设备观测' },
      { id: 'slice', label: '切片' },
      { id: 'timeline', label: '时间线' },
    ],
  },
  {
    group: '对话',
    items: [
      { id: 'chat', label: '对话历史' },
      { id: 'conversation', label: '交流' },
      { id: 'notification', label: '通知' },
    ],
  },
  {
    group: '档案与工具',
    items: [
      { id: 'profile', label: '用户档案' },
      { id: 'terminal-tools', label: '终端工具' },
    ],
  },
]

const allViews = viewGroups.flatMap((g) => g.items)
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

function isTimelineEntry(view: HistoryView, item: HistoryItem) {
  if (!/^history-[1-9][0-9]*-[0-9]+$/.test(item.id)) return false
  if (view === 'timeline') return true
  return view === 'chat' && item.role === 'user' && item.source.includes('活动时间线')
}

function HistoryRecords({
  view,
  items,
  pages,
  read,
  term,
  layer,
  highlightedId,
  onSelectPerception,
}: {
  view: HistoryView
  items: HistoryItem[]
  term: string
  layer?: ActivityLayer
  highlightedId?: string | null
  onSelectPerception?: (eventId: string) => void
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
      {rows.map(({ item, date, heading }) => {
        const highlighted = highlightedId === item.id
        return (
          <li key={item.id}>
            {heading && <h2>{heading}</h2>}
            {item.group ? (
              <GroupRecord item={item} pages={pages} read={read} term={term} />
            ) : (
              <article
                className="history-entry"
                data-message-id={item.id}
                data-highlighted={highlighted ? 'true' : undefined}
              >
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
                {onSelectPerception && isTimelineEntry(view, item) && (
                  <TimelineSources
                    messageId={item.id}
                    onSelectPerception={onSelectPerception}
                  />
                )}
              </article>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function ContextDrawer({ open }: { open: boolean }) {
  const [preview, setPreview] = useState<ContextPreview>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supported = Boolean(window.wintermute?.contextPreview)

  useEffect(() => {
    const api = window.wintermute
    if (!open || !api?.contextPreview) return
    let alive = true
    queueMicrotask(() => {
      if (!alive) return
      setLoading(true)
      setError('')
    })
    api
      .contextPreview()
      .then((res) => {
        if (alive) setPreview(res)
      })
      .catch((e) => {
        if (alive)
          setError(
            e instanceof Error
              ? e.message.replace(/^.*?Error: /, '')
              : '读取模型上下文预览失败。',
          )
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open])

  if (!open) return null
  return (
    <div className="context-drawer">
      <ContextPreviewPanel
        preview={preview}
        loading={loading}
        error={supported ? error : '当前桌面端或后端不支持模型上下文预览。'}
      />
    </div>
  )
}

function HistoryList({
  view,
  label,
  openTimeline,
  onSelectPerception,
  destinationFilter,
  onDestinationFilterChange,
  rangeBounds,
  onClearRange,
  selectedPerceptionId,
  onSelectPerceptionId,
  highlightMessageId,
}: {
  view: HistoryView
  label: string
  openTimeline?: (messageId?: string | null) => void
  onSelectPerception?: (eventId: string) => void
  destinationFilter?: PerceptionDestinationFilter
  onDestinationFilterChange?: (next: PerceptionDestinationFilter) => void
  rangeBounds?: { from: string; to: string; label: string } | null
  onClearRange?: () => void
  selectedPerceptionId?: string
  onSelectPerceptionId?: (id: string) => void
  highlightMessageId?: string | null
}) {
  const historyFilter: HistoryFilter | undefined =
    view === 'perception'
      ? {
          destination:
            destinationFilter && destinationFilter !== 'all'
              ? destinationFilter
              : undefined,
          from: rangeBounds?.from,
          to: rangeBounds?.to,
        }
      : undefined

  const { pages, read } = useHistoryPages(view, historyFilter)
  const page = pages.get(null) ?? emptyPage
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const [showContext, setShowContext] = useState(false)
  const autoSeekPages = useRef(0)
  const scrolledId = useRef<string | null>(null)

  const term = query.trim().toLowerCase()
  const visible = page.items.filter(
    (item) =>
      !term ||
      matches(item, term) ||
      (item.group &&
        pages.get(item.group.id)?.items.some((frame) => matches(frame, term))),
  )

  useEffect(() => {
    autoSeekPages.current = 0
    scrolledId.current = null
  }, [highlightMessageId])

  useEffect(() => {
    if (!highlightMessageId || (view !== 'timeline' && view !== 'chat')) return
    const found = page.items.some((item) => item.id === highlightMessageId)
    if (found) {
      if (scrolledId.current !== highlightMessageId) {
        const el = document.querySelector(
          `[data-message-id="${CSS.escape(highlightMessageId)}"]`,
        )
        if (el) {
          scrolledId.current = highlightMessageId
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
      return
    }
    if (!page.loading && page.next && autoSeekPages.current < 4) {
      autoSeekPages.current += 1
      void read(null, page.next)
    }
  }, [highlightMessageId, view, page.items, page.loading, page.next, read])

  const hasPerceptionFilter =
    view === 'perception' &&
    ((destinationFilter && destinationFilter !== 'all') || Boolean(rangeBounds))

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
        <div className="history-tool-buttons">
          {(view === 'chat' || view === 'timeline') && (
            <button
              type="button"
              className="history-refresh"
              aria-pressed={showContext}
              onClick={() => setShowContext((open) => !open)}
            >
              <Cpu size={14} aria-hidden="true" /> 模型上下文预览
            </button>
          )}
          <button
            className="history-refresh"
            onClick={() => {
              setRevision((n) => n + 1)
              void read(null, null)
            }}
            disabled={page.loading}
          >
            <RotateCw size={14} aria-hidden="true" /> 刷新
          </button>
        </div>
      </div>

      {(view === 'chat' || view === 'timeline') && (
        <ContextDrawer open={showContext} />
      )}

      {view === 'perception' && openTimeline ? (
        (visible.length > 0 || hasPerceptionFilter) && (
          <PerceptionBrowser
            items={visible}
            openTimeline={openTimeline}
            revision={revision}
            destinationFilter={destinationFilter}
            onDestinationFilterChange={onDestinationFilterChange}
            selectedId={selectedPerceptionId}
            onSelectId={onSelectPerceptionId}
            activeRangeLabel={rangeBounds?.label}
            onClearRange={onClearRange}
          />
        )
      ) : (
        <HistoryRecords
          view={view}
          items={visible}
          pages={pages}
          read={read}
          term={term}
          layer={view === 'slice' ? view : undefined}
          highlightedId={highlightMessageId}
          onSelectPerception={onSelectPerception}
        />
      )}
      {!page.loading && !page.error && !visible.length && !hasPerceptionFilter && (
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
  destinationFilter,
  onDestinationFilterChange,
  rangeBounds,
  onClearRange,
  selectedPerceptionId,
  onSelectPerceptionId,
}: {
  layer: ActivityLayer
  label: string
  openTimeline: (messageId?: string | null) => void
  destinationFilter?: PerceptionDestinationFilter
  onDestinationFilterChange?: (next: PerceptionDestinationFilter) => void
  rangeBounds?: { from: string; to: string; label: string } | null
  onClearRange?: () => void
  selectedPerceptionId?: string
  onSelectPerceptionId?: (id: string) => void
}) {
  const [compare, setCompare] = useState(false)
  if (layer === 'perception')
    return (
      <HistoryList
        view={layer}
        label={label}
        openTimeline={openTimeline}
        destinationFilter={destinationFilter}
        onDestinationFilterChange={onDestinationFilterChange}
        rangeBounds={rangeBounds}
        onClearRange={onClearRange}
        selectedPerceptionId={selectedPerceptionId}
        onSelectPerceptionId={onSelectPerceptionId}
      />
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
        <CompressionBrowser
          layer={layer}
          openTimeline={() => openTimeline(null)}
        />
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
  pendingLocalCount = 0,
  settings,
}: {
  connectionKey: string
  connectionRevision?: number
  connected: boolean
  pendingLocalCount?: number
  settings: () => void
}) {
  const [view, setView] = useState<MemoryViewOption>(allViews[0])
  const [destinationFilter, setDestinationFilter] =
    useState<PerceptionDestinationFilter>('all')
  const [rangeBounds, setRangeBounds] = useState<{
    from: string
    to: string
    label: string
  } | null>(null)
  const [selectedPerceptionId, setSelectedPerceptionId] = useState<string>()
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(
    null,
  )

  function openTimeline(messageId?: string | null) {
    setHighlightMessageId(messageId ?? null)
    setView(allViews.find((v) => v.id === 'timeline')!)
  }

  function openPerceptionEvent(eventId: string) {
    setDestinationFilter('all')
    setRangeBounds(null)
    setSelectedPerceptionId(eventId)
    setView(allViews.find((v) => v.id === 'perception')!)
  }

  function openFilteredPerception(
    destination: PerceptionDestinationFilter,
    bounds?: { from: string; to: string },
  ) {
    setDestinationFilter(destination)
    setRangeBounds(
      bounds ? { ...bounds, label: '所选时间段' } : null,
    )
    setSelectedPerceptionId(undefined)
    setView(allViews.find((v) => v.id === 'perception')!)
  }

  return (
    <HistoryConnection.Provider value={connectionRevision}>
      <section className="browse-page history-browser" data-view={view.id}>
        <div className="page-heading">
          <h1>记忆</h1>
        </div>
        <nav className="history-views-grouped" aria-label="历史视图">
          {viewGroups.map((group) => (
            <div key={group.group} className="history-view-group">
              <span className="history-view-group-label">{group.group}</span>
              <div className="history-view-group-buttons" role="group" aria-label={group.group}>
                {group.items.map((v) => (
                  <button
                    key={v.id}
                    aria-pressed={view.id === v.id}
                    onClick={() => {
                      if (v.id !== 'timeline') setHighlightMessageId(null)
                      setView(v)
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        {connected ? (
          view.id === 'overview' ? (
            <FlowOverview
              key={connectionKey}
              pendingLocalCount={pendingLocalCount}
              onFilterPerception={openFilteredPerception}
              revision={connectionRevision ?? 0}
            />
          ) : view.id === 'profile' ? (
            <UserProfile key={connectionKey} />
          ) : view.id === 'terminal-tools' ? (
            <TerminalToolHistory key={connectionKey} />
          ) : view.id === 'slice' || view.id === 'perception' ? (
            <ActivityHistory
              key={connectionKey + view.id}
              layer={view.id}
              label={view.label}
              openTimeline={openTimeline}
              destinationFilter={destinationFilter}
              onDestinationFilterChange={setDestinationFilter}
              rangeBounds={rangeBounds}
              onClearRange={() => setRangeBounds(null)}
              selectedPerceptionId={selectedPerceptionId}
              onSelectPerceptionId={setSelectedPerceptionId}
            />
          ) : (
            <HistoryList
              key={connectionKey + view.id}
              view={view.id}
              label={view.label}
              highlightMessageId={highlightMessageId}
              onSelectPerception={openPerceptionEvent}
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
