import { Fragment, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, ChevronDown, ChevronRight } from 'lucide-react'
import type {
  HistoryItem,
  PerceptionDestinationFilter,
  PerceptionRound,
  PerceptionStages,
} from '@/lib/desktop'
import {
  byteLength,
  formatBytes,
  formatBytesCompact,
  formatBytesShort,
  itemDestination,
  perceptionLabel,
  record,
} from '@/lib/perception'
import { PerceptionRecord } from './perception-record'
import { CompressionBrowser } from './compression-browser'

const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' })
const clock = new Intl.DateTimeFormat('zh-CN', {
  timeStyle: 'medium',
  hour12: false,
})

const filterOptions: { value: PerceptionDestinationFilter; label: string }[] = [
  { value: 'all', label: '全部记录' },
  { value: 'delivered', label: '✅ 已进入上下文' },
  { value: 'summarized', label: '🧠 已并入摘要' },
  { value: 'buffered', label: '⏳ 缓冲中' },
  { value: 'partial', label: '✂️ 部分过滤' },
  { value: 'kept', label: '已保留（全部）' },
  { value: 'filtered', label: '⛔ 已过滤' },
]

const roundStatus: Record<PerceptionRound['status'], string> = {
  pending: '等待摘要结果',
  ready: '摘要已生成',
  retrying: '生成失败，等待重试',
  disabled: '滚动摘要已关闭',
}

function formatClock(iso?: string | null) {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return clock.format(new Date(ms))
}

function formatSpan(start?: string | null, end?: string | null) {
  const s = formatClock(start)
  const e = formatClock(end)
  if (!s && !e) return ''
  if (!e || s === e) return s || e
  return `${s}–${e}`
}

function StepBlock({
  step,
  title,
  summary,
  badge,
  muted,
  defaultOpen = true,
  children,
}: {
  step: string
  title: string
  summary: string
  badge?: string
  muted?: boolean
  defaultOpen?: boolean
  children?: React.ReactNode
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const open = manualOpen ?? defaultOpen

  return (
    <section
      className="flow-step"
      data-muted={muted ? 'true' : 'false'}
      aria-label={`${step} ${title}`}
    >
      <div className="flow-step-rail" aria-hidden="true">
        <span className="flow-step-num">{step}</span>
        <span className="flow-step-line" />
      </div>
      <div className="flow-step-body">
        <div className="flow-step-head">
          <div className="flow-step-title">
            <h3>{title}</h3>
            {summary && <span className="flow-step-summary">{summary}</span>}
          </div>
          <div className="flow-step-meta">
            {badge && <small className="flow-step-badge">{badge}</small>}
            {children && (
              <button
                type="button"
                className="flow-step-toggle"
                aria-expanded={open}
                onClick={() => setManualOpen(!open)}
              >
                {open ? (
                  <>
                    收起 <ChevronDown size={13} aria-hidden />
                  </>
                ) : (
                  <>
                    展开 <ChevronRight size={13} aria-hidden />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
        {children && open && <div className="flow-step-content">{children}</div>}
      </div>
    </section>
  )
}

function CaptureStep({ item }: { item: HistoryItem }) {
  const payload = record(item.raw?.payload)
  const value = record(payload.value)
  const changes = Array.isArray(value.work_objects) ? value.work_objects.length : 0
  const shots = item.files.length
  const rawBytes = item.raw ? byteLength(JSON.stringify(item.raw)) : byteLength(item.text || '')
  const pieces = [
    payload.state_key === 'desktop.window_span' ? '1 次桌面停留' : '1 条设备观测',
    changes > 0 ? `${changes} 次标题变化` : '',
    shots > 0 ? `${shots} 张截图` : '',
  ]
    .filter(Boolean)
    .join('，')

  return (
    <StepBlock
      step="①"
      title="本机采集"
      summary={pieces}
      badge={formatBytesCompact(rawBytes)}
      defaultOpen={true}
    >
      <PerceptionRecord item={item} />
    </StepBlock>
  )
}

function FilterStep({
  item,
  data,
}: {
  item: HistoryItem
  data: PerceptionStages
}) {
  const threshold = data.dwell_threshold_seconds ?? 3
  const rawBytes = item.raw ? byteLength(JSON.stringify(item.raw)) : 0
  const retainedBytes =
    data.retained !== null && data.retained !== undefined
      ? byteLength(JSON.stringify(data.retained))
      : 0
  const removed = data.decisions.filter((row) => !row.kept)

  if (!data.parts.length) {
    return (
      <StepBlock
        step="②"
        title="规则过滤"
        summary="本次上报没有在本会话形成活动记录"
        muted
        defaultOpen={false}
      />
    )
  }

  const droppedAll = data.retained === null
  const summary = droppedAll
    ? `整次停留未超过 ${threshold} 秒，已过滤（仅保留原始记录）`
    : removed.length
      ? `过滤 ${removed.length} 个 ≤${threshold} 秒短标题，保留其余内容`
      : data.decisions.length
        ? `全部保留（均超过 ${threshold} 秒阈值）`
        : '无需短停留筛选，直接保留'

  const sizeText =
    rawBytes > 0
      ? droppedAll
        ? `${formatBytesShort(rawBytes)} → 0 字节`
        : `${formatBytesShort(rawBytes)} → ${formatBytesShort(retainedBytes)}`
      : ''

  const shouldExpand = droppedAll || removed.length > 0

  return (
    <StepBlock
      step="②"
      title="规则过滤"
      summary={summary}
      badge={sizeText}
      muted={droppedAll}
      defaultOpen={shouldExpand}
    >
      <p className="stage-note">
        应用或窗口标题停留 {threshold} 秒及以内会被过滤，不进入后续时间线。
      </p>
      {data.decisions.length > 0 && (
        <table className="rule-decisions">
          <thead>
            <tr>
              <th>工作对象</th>
              <th>停留</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            {data.decisions.map((row, index) => (
              <tr key={index} data-kept={row.kept}>
                <td>
                  <small>{row.kind === 'application' ? '应用' : '标题'}</small>
                  {row.label}
                </td>
                <td>
                  {row.seconds.toLocaleString('zh-CN', {
                    maximumFractionDigits: 6,
                  })}{' '}
                  秒
                </td>
                <td>
                  {row.kept
                    ? `保留（>${threshold} 秒）`
                    : `过滤（≤${threshold} 秒）`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.retained !== null && (
        <details className="stage-disclosure">
          <summary>查看规则处理后的字段（{formatBytes(retainedBytes)}）</summary>
          <pre className="perception-json">
            {JSON.stringify(data.retained, null, 2)}
          </pre>
        </details>
      )}
    </StepBlock>
  )
}

function TimelineTextStep({ data }: { data: PerceptionStages }) {
  const parts = data.parts.filter((part) => part.text)
  if (!parts.length) {
    return (
      <StepBlock
        step="③"
        title="时间线文字"
        summary={
          data.parts.length
            ? '已被规则过滤，未生成时间线文字'
            : '本会话没有对应时间线文字'
        }
        muted
        defaultOpen={false}
      />
    )
  }

  const totalBytes = parts.reduce((acc, part) => acc + byteLength(part.text), 0)
  const hasVisual = parts.some((part) => part.kind === 'visual')
  const firstLine = parts[0].text.split('\n')[0]
  const preview =
    firstLine.length > 48 ? firstLine.slice(0, 48) + '…' : firstLine

  return (
    <StepBlock
      step="③"
      title="时间线文字"
      summary={`「${preview}」${hasVisual ? ' + 截图识别补充' : ''}`}
      badge={formatBytes(totalBytes)}
      defaultOpen={true}
    >
      {parts.map((part) => (
        <section key={part.kind} className="stage-section">
          <div className="stage-caption">
            <h4>{part.kind === 'visual' ? '截图识别补充' : '观测记录'}</h4>
            <small>{formatBytes(byteLength(part.text))}</small>
          </div>
          <pre className="stage-text">{part.text}</pre>
        </section>
      ))}
    </StepBlock>
  )
}

function SummaryStep({
  data,
  onSelectRecord,
}: {
  data: PerceptionStages
  onSelectRecord: (id: string) => void
}) {
  const activeParts = data.parts.filter((part) => part.text)
  if (!activeParts.length) {
    return (
      <StepBlock
        step="④"
        title="滚动摘要"
        summary="未生成时间线文字，无需滚动摘要"
        muted
        defaultOpen={false}
      />
    )
  }

  const remaining = activeParts.filter((part) => part.round_id === null)
  const accumulating = remaining.some((part) => !part.delivered)

  if (!data.rounds.length && !accumulating) {
    return (
      <StepBlock
        step="④"
        title="滚动摘要"
        summary="未触发后台滚动摘要（已直接以原文带入上下文）"
        muted
        defaultOpen={false}
      />
    )
  }

  const firstRound = data.rounds[0]
  let summaryText = ''
  let badgeText = ''
  if (firstRound) {
    const count = firstRound.member_count ?? firstRound.members?.length ?? 0
    const others = count > 1 ? `和另外 ${count - 1} 条观测` : ''
    const span = formatSpan(firstRound.started_at, firstRound.ended_at)
    summaryText = `${others}合成摘要 R${firstRound.id}${span ? `（${span}）` : ''}`
    const inBytes = byteLength(firstRound.input)
    const outBytes = firstRound.summary ? byteLength(firstRound.summary) : 0
    badgeText = firstRound.summary
      ? `${formatBytesShort(inBytes)} → ${formatBytesShort(outBytes)}`
      : roundStatus[firstRound.status]
  } else {
    summaryText = !data.ai_enabled
      ? '滚动摘要已关闭，等待下次对话带入'
      : data.pending_size > data.budget
        ? '已超出单次带入上限，等待后台生成摘要'
        : '缓冲中，等待积累或下次对话带入'
    badgeText = `${data.pending_size.toLocaleString('zh-CN')} / ${data.budget.toLocaleString('zh-CN')} 字节`
  }

  return (
    <StepBlock
      step="④"
      title="滚动摘要"
      summary={summaryText}
      badge={badgeText}
      defaultOpen={true}
    >
      {data.rounds.map((round) => {
        const members = round.members ?? []
        const memberCount = round.member_count ?? members.length
        const span = formatSpan(round.started_at, round.ended_at)
        const nextChain = round.later ?? []
        return (
          <section key={round.id} className="stage-section round-card">
            <div className="stage-caption">
              <h4>
                摘要 R{round.id}
                {span ? ` · ${span}` : ''}
                {memberCount > 0 ? ` · 共 ${memberCount} 条观测` : ''}
              </h4>
              <small>{roundStatus[round.status]}</small>
            </div>
            {data.parts.length > 1 && (
              <p className="stage-note">
                本条纳入：
                {data.parts
                  .filter((part) => part.round_id === round.id)
                  .map((part) =>
                    part.kind === 'visual' ? '截图识别补充' : '观测记录',
                  )
                  .join('、')}
              </p>
            )}
            {round.summary && <p className="stage-summary">{round.summary}</p>}
            <p className="stage-note">
              本轮输入 {formatBytes(byteLength(round.input))}
              {round.summary
                ? ` → 摘要输出 ${formatBytes(byteLength(round.summary))}`
                : ''}
            </p>
            <div className="round-disclosures">
              {members.length > 0 && (
                <details className="stage-disclosure">
                  <summary>查看同轮 {memberCount} 条观测</summary>
                  <ol className="round-members-list">
                    {members.map((member, idx) => (
                      <li key={`${member.id}-${idx}`}>
                        <time dateTime={member.occurred_at ?? undefined}>
                          {formatClock(member.occurred_at)}
                        </time>
                        <span>{member.text}</span>
                        <button
                          type="button"
                          className="history-inline"
                          onClick={() => onSelectRecord(member.id)}
                        >
                          查看 <ArrowUpRight size={13} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              <details className="stage-disclosure">
                <summary>查看本轮完整输入（R{round.id}）</summary>
                <pre className="stage-text">{round.input}</pre>
              </details>
              {nextChain.length > 0 && (
                <details className="stage-disclosure">
                  <summary>
                    链式滚动：后续并入{' '}
                    {nextChain.map((item) => `R${item.id}`).join(' → ')}
                  </summary>
                  <ol className="round-chain-list">
                    {nextChain.map((later) => (
                      <li key={later.id}>
                        <strong>
                          R{later.id}（{roundStatus[later.status]}）
                        </strong>
                        {later.summary && <p>{later.summary}</p>}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          </section>
        )
      })}
      {accumulating && (
        <section className="stage-section">
          <p className="stage-note">
            当前会话缓冲：{data.pending_size.toLocaleString('zh-CN')} /{' '}
            {data.budget.toLocaleString('zh-CN')} 字节（单次带入上限{' '}
            {data.budget.toLocaleString('zh-CN')} 字节）
          </p>
        </section>
      )}
    </StepBlock>
  )
}

function DeliveryStep({
  data,
  openTimeline,
}: {
  data: PerceptionStages
  openTimeline: (messageId?: string | null) => void
}) {
  const activeParts = data.parts.filter((part) => part.text)
  const deliveredParts = activeParts.filter((part) => part.delivered)

  if (!activeParts.length) {
    return (
      <StepBlock
        step="⑤"
        title="进入对话"
        summary="已过滤，不会进入模型上下文"
        muted
        defaultOpen={false}
      />
    )
  }

  if (!deliveredParts.length) {
    return (
      <StepBlock
        step="⑤"
        title="进入对话"
        summary="⏳ 尚未被对话读取，将在下次用户对话时带入"
        defaultOpen={true}
      >
        <p className="stage-note">
          单次带入上限 {data.budget.toLocaleString('zh-CN')} 字节，当前待带入{' '}
          {data.pending_size.toLocaleString('zh-CN')} 字节。
        </p>
        <button
          type="button"
          className="history-inline stage-link"
          onClick={() => openTimeline(null)}
        >
          查看时间线历史 <ArrowUpRight size={14} aria-hidden />
        </button>
      </StepBlock>
    )
  }

  const deliveries = deliveredParts
    .map((part) => ({
      part,
      delivery: part.delivery,
    }))
    .filter(
      (entry, idx, arr) =>
        arr.findIndex(
          (other) =>
            other.delivery?.message?.id &&
            other.delivery.message.id === entry.delivery?.message?.id,
        ) === idx || !entry.delivery?.message?.id,
    )

  const primary = deliveries[0]
  const formLabel =
    primary.delivery?.form === 'summary'
      ? '以滚动摘要形式进入'
      : primary.delivery?.form === 'raw'
        ? '以原文形式进入'
        : primary.part.round_id
          ? '已随时间线进入'
          : '以原文形式进入'
  const when = formatClock(
    primary.delivery?.delivered_at ?? primary.delivery?.message?.timestamp,
  )

  return (
    <StepBlock
      step="⑤"
      title="进入对话"
      summary={`${when ? `${when} ` : ''}${formLabel}`}
      badge={
        primary.delivery?.message?.text
          ? formatBytes(byteLength(primary.delivery.message.text))
          : undefined
      }
      defaultOpen={true}
    >
      {deliveries.map(({ part, delivery }, index) => {
        const message = delivery?.message
        const trigger = delivery?.trigger
        const form =
          delivery?.form === 'summary'
            ? '🧠 摘要形式'
            : delivery?.form === 'raw'
              ? '📝 原文形式'
              : part.round_id
                ? '🧠 随摘要带入'
                : '📝 原文形式'
        return (
          <div key={message?.id ?? `del-${index}`} className="delivery-card">
            <div className="delivery-card-head">
              <span className="flow-pill tone-ok">{form}</span>
              {delivery?.delivered_at && (
                <small>{formatClock(delivery.delivered_at)}</small>
              )}
            </div>
            {trigger && (
              <p className="stage-note">
                触发对话：「{trigger.text}」
              </p>
            )}
            {message ? (
              <>
                <details className="stage-disclosure">
                  <summary>
                    查看当次带入的「活动时间线」（{formatBytes(byteLength(message.text))}）
                  </summary>
                  <pre className="stage-text">{message.text}</pre>
                </details>
                <button
                  type="button"
                  className="history-inline stage-link"
                  onClick={() => openTimeline(message.id)}
                >
                  定位到该消息 <ArrowUpRight size={14} aria-hidden />
                </button>
              </>
            ) : (
              <>
                <p className="stage-note">
                  已有投递回执，{part.round_id ? '已随摘要带入' : '未经过单独 AI 摘要，以原文带入'}。
                </p>
                <button
                  type="button"
                  className="history-inline stage-link"
                  onClick={() => openTimeline(null)}
                >
                  查看时间线历史 <ArrowUpRight size={14} aria-hidden />
                </button>
              </>
            )}
          </div>
        )
      })}
    </StepBlock>
  )
}

function FlowTrace({
  item,
  revision,
  openTimeline,
  onSelectRecord,
  onStagesLoaded,
}: {
  item: HistoryItem
  revision: number
  openTimeline: (messageId?: string | null) => void
  onSelectRecord: (id: string) => void
  onStagesLoaded: (id: string, stages: PerceptionStages) => void
}) {
  const [data, setData] = useState<PerceptionStages>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [browseBatches, setBrowseBatches] = useState(false)

  useEffect(() => {
    let current = true
    let pending = false
    const api = window.wintermute
    async function read() {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        if (!api?.compression) throw new Error('当前终端无法读取压缩过程。')
        const result = await api.compression({ kind: 'stages', id: item.id })
        if (current) {
          setData(result)
          setError('')
          onStagesLoaded(item.id, result)
        }
      } catch (e) {
        if (current) {
          setError(
            e instanceof Error
              ? e.message.replace(/^.*?Error: /, '')
              : '读取处理过程失败。',
          )
        }
      } finally {
        pending = false
      }
    }
    void read()
    const timer = window.setInterval(read, 5000)
    window.addEventListener('focus', read)
    return () => {
      current = false
      clearInterval(timer)
      window.removeEventListener('focus', read)
    }
  }, [item.id, retry, revision, onStagesLoaded])

  return (
    <div className="flow-trace">
      <CaptureStep item={item} />
      {error ? (
        <div className="flow-step-error">
          <p role="alert" className="history-error">
            {error}
          </p>
          <div className="history-actions">
            <button
              onClick={() => {
                setError('')
                setRetry((n) => n + 1)
              }}
            >
              重试
            </button>
            <button
              aria-expanded={browseBatches}
              onClick={() => setBrowseBatches(!browseBatches)}
            >
              浏览后端压缩批次
            </button>
          </div>
          {browseBatches && (
            <CompressionBrowser
              layer="perception"
              openTimeline={() => openTimeline(null)}
            />
          )}
        </div>
      ) : !data ? (
        <p className="stage-note" role="status">
          正在读取后续流向…
        </p>
      ) : (
        <>
          <FilterStep item={item} data={data} />
          <TimelineTextStep data={data} />
          <SummaryStep data={data} onSelectRecord={onSelectRecord} />
          <DeliveryStep data={data} openTimeline={openTimeline} />
        </>
      )}
    </div>
  )
}

function matchesDestinationFilter(
  item: HistoryItem,
  filter: PerceptionDestinationFilter,
  stageCache: Map<string, PerceptionStages>,
) {
  if (filter === 'all') return true
  const badge = itemDestination(item, stageCache.get(item.id))
  if (filter === 'partial') return item.filter_result === 'partial'
  if (filter === 'kept') {
    return badge.key !== 'filtered' && badge.key !== 'unprojected'
  }
  return badge.key === filter
}

export function PerceptionBrowser({
  items,
  openTimeline,
  revision,
  destinationFilter = 'all',
  onDestinationFilterChange,
  selectedId,
  onSelectId,
  activeRangeLabel,
  onClearRange,
}: {
  items: HistoryItem[]
  openTimeline: (messageId?: string | null) => void
  revision: number
  destinationFilter?: PerceptionDestinationFilter
  onDestinationFilterChange?: (next: PerceptionDestinationFilter) => void
  selectedId?: string
  onSelectId?: (id: string) => void
  activeRangeLabel?: string
  onClearRange?: () => void
}) {
  const [internalSelected, setInternalSelected] = useState(items[0]?.id)
  const [internalFilter, setInternalFilter] =
    useState<PerceptionDestinationFilter>('all')
  const [stageCache, setStageCache] = useState(
    () => new Map<string, PerceptionStages>(),
  )

  const filter = onDestinationFilterChange ? destinationFilter : internalFilter
  const setFilter = onDestinationFilterChange ?? setInternalFilter
  const selected = selectedId ?? internalSelected
  const setSelected = onSelectId ?? setInternalSelected

  const onStagesLoaded = useMemo(
    () => (id: string, stages: PerceptionStages) => {
      setStageCache((prev) => {
        if (prev.get(id) === stages) return prev
        const next = new Map(prev)
        next.set(id, stages)
        return next
      })
    },
    [],
  )

  const hasOutcomes = items.some(
    (item) => item.destination || item.filter_result,
  )
  const matches = useMemo(
    () =>
      !hasOutcomes || filter === 'all'
        ? items
        : items.filter((item) =>
            matchesDestinationFilter(item, filter, stageCache),
          ),
    [items, hasOutcomes, filter, stageCache],
  )
  const active = matches.find((item) => item.id === selected) ?? matches[0]
  const info = active && perceptionLabel(active)
  const activeBadge = active
    ? itemDestination(active, stageCache.get(active.id))
    : null

  const records = matches.map((item) => {
    const instant = item.occurred_at ? new Date(item.occurred_at) : null
    const ts = instant && Number.isFinite(+instant) ? instant : null
    return { item, ts, day: ts ? date.format(ts) : '时间未记录' }
  })

  return (
    <div className="perception-workspace">
      <nav className="perception-index" aria-label="采集记录">
        <label className="perception-outcome">
          去向筛选
          <select
            aria-label="按去向筛选"
            value={filter}
            disabled={!hasOutcomes && !onDestinationFilterChange}
            onChange={(event) =>
              setFilter(event.target.value as PerceptionDestinationFilter)
            }
          >
            {filterOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {!hasOutcomes && !onDestinationFilterChange && (
            <small>更新后端后可按去向筛选</small>
          )}
        </label>
        {activeRangeLabel && (
          <div className="perception-range-pill">
            <span>范围：{activeRangeLabel}</span>
            {onClearRange && (
              <button type="button" onClick={onClearRange}>
                清除
              </button>
            )}
          </div>
        )}
        {records.map(({ item, ts, day }, index) => {
          const heading = day !== records[index - 1]?.day
          const label = perceptionLabel(item)
          const badge = itemDestination(item, stageCache.get(item.id))
          return (
            <Fragment key={item.id}>
              {heading && <h2>{day}</h2>}
              <button
                className="perception-choice"
                aria-pressed={item.id === active?.id}
                onClick={() => setSelected(item.id)}
              >
                <span>
                  <strong>{label.title}</strong>
                  <time dateTime={item.occurred_at ?? undefined}>
                    {ts ? clock.format(ts) : ''}
                  </time>
                </span>
                <small>
                  {[label.subject || label.source, label.duration]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
                <span className={`destination-pill tone-${badge.tone}`}>
                  {badge.icon} {badge.label}
                </span>
              </button>
            </Fragment>
          )
        })}
      </nav>
      {active && info && activeBadge ? (
        <article
          className="perception-inspect"
          aria-label={info.title + '的流向追踪'}
        >
          <header className="perception-inspect-head">
            <div>
              <small>
                {[info.source, info.duration].filter(Boolean).join(' · ')}
              </small>
              <h2>{info.title}</h2>
            </div>
            <span className={`destination-pill tone-${activeBadge.tone}`}>
              {activeBadge.icon} {activeBadge.label}
            </span>
          </header>
          <FlowTrace
            key={active.id}
            item={active}
            revision={revision}
            openTimeline={openTimeline}
            onSelectRecord={setSelected}
            onStagesLoaded={onStagesLoaded}
          />
        </article>
      ) : (
        <p className="stage-note" role="status">
          已加载的记录中没有符合此筛选条件的停留。
        </p>
      )}
    </div>
  )
}
