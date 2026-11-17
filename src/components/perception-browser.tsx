import { useEffect, useRef, useState } from 'react'
import { ChevronRight, MessageSquareText, NotebookText } from 'lucide-react'
import type {
  ContextMessageRef,
  HistoryItem,
  PerceptionStages,
  SummaryRoundRef,
  TraceMember,
} from '@/lib/desktop'
import { perceptionLabel, record, text } from '@/lib/perception'
import { PerceptionRecord } from './perception-record'
import { PerceptionLinks, type TraceNavigation } from './perception-links'

const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' })
const clock = new Intl.DateTimeFormat('zh-CN', {
  timeStyle: 'medium',
  hour12: false,
})
const size = (text: string) =>
  new TextEncoder().encode(text).length.toLocaleString('zh-CN')

const outcomes = {
  filtered: '整条过滤',
  partial: '部分标题过滤',
  kept: '完整保留',
  unprojected: '未形成活动',
} as const

function RuleResult({ data }: { data: PerceptionStages }) {
  if (!data.parts.length)
    return <p className="stage-note">这次上报没有在本会话形成新的活动记录。</p>
  // Servers predating per-record thresholds used three seconds.
  const threshold = data.dwell_threshold_seconds ?? 3
  const removed = data.decisions.filter((row) => !row.kept).length
  return (
    <>
      <h3>
        {data.retained === null
          ? '整次停留已过滤'
          : removed
            ? `已过滤 ${removed} 个短停留标题`
            : '保留这条观测'}
      </h3>
      {data.decisions.length > 0 && (
        <>
          <p className="stage-note">
            应用或窗口标题停留 {threshold} 秒及以内会被过滤。
          </p>
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
                    <small>
                      {row.kind === 'application' ? '应用' : '标题'}
                    </small>
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
                      ? `保留（超过 ${threshold} 秒）`
                      : `过滤（${threshold} 秒及以内）`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {data.retained !== null && (
        <details className="stage-disclosure">
          <summary>规则处理后的字段</summary>
          <pre className="perception-json">
            {JSON.stringify(data.retained, null, 2)}
          </pre>
        </details>
      )}
    </>
  )
}

function Formatted({ data }: { data: PerceptionStages }) {
  const parts = data.parts.filter((part) => part.text)
  if (!parts.length)
    return (
      <p className="stage-note">
        {data.parts.length
          ? '整条记录已被规则过滤，没有生成时间线文字。'
          : '本会话没有这次上报的时间线文字。'}
      </p>
    )
  return (
    <>
      {parts.map((part) => (
        <section key={part.kind} className="stage-section">
          <div className="stage-caption">
            <h3>{part.kind === 'visual' ? '截图识别补充' : '观测记录'}</h3>
            <small>{size(part.text)} 估算单位</small>
          </div>
          <pre className="stage-text">{part.text}</pre>
        </section>
      ))}
    </>
  )
}

const roundStatus = {
  pending: '等待摘要结果',
  ready: '摘要已生成',
  retrying: '生成失败，等待重试',
  disabled: 'AI 压缩已关闭',
}

function AIResult({
  data,
  eventId,
  navigation,
}: {
  data: PerceptionStages
  eventId: string
  navigation: TraceNavigation
}) {
  const remaining = data.parts.filter(
    (part) => part.text && part.round_id === null,
  )
  const accumulating = remaining.some((part) => !part.delivered)
  return (
    <>
      {data.rounds.map((round) => (
        <section key={round.id} className="stage-section">
          <div className="stage-caption">
            <h3>本轮滚动摘要</h3>
            <small>{roundStatus[round.status]}</small>
          </div>
          {data.parts.length > 1 && (
            <p className="stage-note">
              本轮纳入
              {data.parts
                .filter((part) => part.round_id === round.id)
                .map((part) =>
                  part.kind === 'visual' ? '截图识别补充' : '观测记录',
                )
                .join('、')}
            </p>
          )}
          {round.summary && <p className="stage-summary">{round.summary}</p>}
          {round.timeline_entry && round.summary && (
            <button
              className="history-inline"
              onClick={() =>
                navigation.openSummary(round.timeline_entry!, round.summary!)
              }
            >
              在时间轴查看这次摘要 ↗
            </button>
          )}
          <p className="stage-note">
            本轮输入 {size(round.input)}
            {round.summary ? ` → 输出 ${size(round.summary)}` : ''} 估算单位
          </p>
          {data.context_messages && (
            <PerceptionLinks
              target={'round-' + round.id}
              eventId={eventId}
              {...navigation}
            />
          )}
          <details className="stage-disclosure">
            <summary>查看本轮完整输入</summary>
            <pre className="stage-text">{round.input}</pre>
          </details>
        </section>
      ))}
      {accumulating && (
        <section className="stage-section">
          <h3>
            {!data.ai_enabled
              ? 'AI 压缩已关闭'
              : data.pending_size > data.budget
                ? '已超预算，等待后台处理'
                : '尚未超过压缩预算'}
          </h3>
          <p className="stage-note">
            当前会话待处理 {data.pending_size.toLocaleString()} /{' '}
            {data.budget.toLocaleString()} 估算单位
          </p>
        </section>
      )}
      {remaining.some((part) => part.delivered) && (
        <p className="stage-note">
          本次活动已有投递回执，对应文字没有单独保存的 AI 摘要。
        </p>
      )}
      {!data.rounds.length && !remaining.length && (
        <p className="stage-note">
          {data.parts.length
            ? '规则已过滤这条记录，无需 AI 压缩。'
            : '本会话没有可用于压缩的新观测。'}
        </p>
      )}
    </>
  )
}

function VisitDetails({
  id,
  item,
  revision,
  navigation,
}: {
  id: string
  item?: HistoryItem
  revision: number
  navigation: TraceNavigation
}) {
  const [data, setData] = useState<PerceptionStages>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const needsRecord = !item
  useEffect(() => {
    let mounted = true
    let reading = false
    async function read() {
      if (reading || document.visibilityState === 'hidden') return
      reading = true
      try {
        if (!window.wintermute?.compression)
          throw new Error('当前终端无法读取处理记录。')
        const next = await window.wintermute.compression({
          kind: 'stages',
          id,
          ...(needsRecord && { record: true }),
        })
        if (mounted) {
          setData(next)
          setError('')
        }
      } catch (e) {
        if (mounted)
          setError(
            e instanceof Error
              ? e.message.replace(/^.*?Error: /, '')
              : '读取失败。',
          )
      } finally {
        reading = false
      }
    }
    void read()
    const timer = window.setInterval(read, 5000)
    window.addEventListener('focus', read)
    return () => {
      mounted = false
      clearInterval(timer)
      window.removeEventListener('focus', read)
    }
  }, [id, needsRecord, revision, retry])
  const raw = item ?? data?.record
  const messages = data?.context_messages ?? raw?.context_messages
  const nonempty = data?.parts.filter((part) => part.text)
  const pending = nonempty?.some((part) => !part.delivered)
  return (
    <div className="perception-stage">
      {raw && (
        <section>
          <h3>采到了什么</h3>
          <PerceptionRecord item={raw} />
        </section>
      )}
      {error && (
        <div role="alert" className="history-error">
          {error} <button onClick={() => setRetry((n) => n + 1)}>重试</button>
        </div>
      )}
      {!data && !error && <p role="status">正在读取处理记录…</p>}
      {data && (
        <>
          <section>
            <h3>哪些信息被过滤</h3>
            <RuleResult data={data} />
          </section>
          {nonempty && nonempty.length > 0 && (
            <details className="stage-disclosure">
              <summary>查看规则处理后的活动文字</summary>
              <Formatted data={data} />
            </details>
          )}
          {!!data.rounds.length && (
            <section>
              <h3>摘要合并</h3>
              <AIResult data={data} eventId={id} navigation={navigation} />
            </section>
          )}
          <section>
            <h3>最终进入上下文</h3>
            {messages?.map((message) => (
              <div key={message.id}>
                {message.parts?.length && data.parts.length > 1 && (
                  <p className="stage-note">
                    {message.parts
                      .map((part) =>
                        part === 'visual' ? '截图识别补充' : '停留记录',
                      )
                      .join('、')}
                  </p>
                )}
                <PerceptionLinks
                  target={message.id}
                  eventId={id}
                  message={message}
                  {...navigation}
                />
              </div>
            ))}
            {pending && (
              <p className="stage-note">
                {messages?.length
                  ? '另有活动文字等待写入会话。'
                  : '活动文字已生成，等待写入会话。'}
              </p>
            )}
            {!messages?.length && !pending && (
              <p className="stage-note">
                {!data.parts.length
                  ? '本会话没有由这次采集生成的活动文字。'
                  : !nonempty?.length
                    ? '整条被过滤，没有上下文原文。'
                    : '已有处理回执，无法定位当时的上下文原文。'}
              </p>
            )}
            {!data.rounds.length && pending && (
              <details className="stage-disclosure">
                <summary>查看压缩进度</summary>
                <AIResult data={data} eventId={id} navigation={navigation} />
              </details>
            )}
          </section>
        </>
      )}
    </div>
  )
}

type TimelineRow = {
  id: string
  at: string | null
  title: string
  subtitle: string
  status: string
  kind: 'visit' | 'summary' | 'message'
  item?: HistoryItem
}

function visitRow(item: HistoryItem): TimelineRow {
  const info = perceptionLabel(item)
  const value = record(record(item.raw?.payload).value)
  return {
    kind: 'visit',
    id: item.id,
    at: text(value.started_at) || item.occurred_at,
    title: info.title,
    subtitle: [info.duration, info.subject, info.source]
      .filter(Boolean)
      .join(' · '),
    status: item.context_messages?.length
      ? item.pending_context
        ? '部分已写入'
        : '已关联上下文'
      : item.pending_context
        ? '等待写入'
        : item.filter_result
          ? outcomes[item.filter_result]
          : '',
    item,
  }
}
function messageRow(message: ContextMessageRef): TimelineRow {
  return {
    id: message.id,
    at: message.written_at ?? message.activity_at ?? null,
    title: '时间线消息写入上下文',
    subtitle: message.written_at
      ? '会话原文'
      : message.activity_at
        ? '按消息内的活动时间排列 · 写入时刻未记录'
        : '写入时刻未记录',
    status: '已写入',
    kind: 'message',
  }
}

function summaryRow(ref: SummaryRoundRef, summary: string): TimelineRow {
  return {
    kind: 'summary',
    id: ref.id,
    at: ref.occurred_at,
    title: 'AI 摘要',
    status: '已生成',
    subtitle: ref.generated_at
      ? summary
      : '按本轮开始时间排列 · 生成时刻未记录',
  }
}

const atSameTime = { visit: 0, summary: 1, message: 2 }

export function PerceptionBrowser({
  items,
  revision,
}: {
  items: HistoryItem[]
  revision: number
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [linked, setLinked] = useState<TimelineRow[]>([])
  const [outcome, setOutcome] = useState('all')
  const focusTarget = useRef<string | null>(null)
  const rows = new Map<string, TimelineRow>()
  for (const row of linked) rows.set(row.id, row)
  for (const item of items) {
    if (outcome !== 'all' && item.filter_result !== outcome) continue
    rows.set(
      item.id,
      item.summary_round
        ? summaryRow(item.summary_round, item.text)
        : visitRow(item),
    )
    for (const ref of item.context_messages ?? [])
      rows.set(ref.id, messageRow(ref))
  }
  const ordered = [...rows.values()].sort(
    (a, b) =>
      (Date.parse(a.at ?? '') || Infinity) -
        (Date.parse(b.at ?? '') || Infinity) ||
      atSameTime[a.kind] - atSameTime[b.kind],
  )
  function jump(row: TimelineRow) {
    setOutcome('all')
    if (!rows.has(row.id)) setLinked((prior) => [...prior, row])
    setSelected(row.id)
    focusTarget.current = row.id
  }
  const navigation: TraceNavigation = {
    openMember: (member: TraceMember) => {
      if (member.event_id)
        jump({
          kind: 'visit',
          id: member.event_id,
          at: member.occurred_at,
          title: member.title,
          subtitle: member.terminal,
          status: '关联记录',
        })
    },
    openMessage: (message) => jump(messageRow(message)),
    openSummary: (ref, summary) => jump(summaryRow(ref, summary)),
  }
  useEffect(() => {
    if (!selected || focusTarget.current !== selected) return
    const button = document.getElementById('perception-row-' + selected)
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'start' })
    focusTarget.current = null
  }, [selected])
  return (
    <div className="perception-timeline">
      <div className="trace-heading">
        <h2>活动时间轴</h2>
        {items.some((i) => i.filter_result) && (
          <label className="perception-outcome">
            过滤结果
            <select
              aria-label="按过滤结果筛选"
              value={outcome}
              onChange={(e) => {
                setOutcome(e.target.value)
                setLinked([])
                setSelected(null)
              }}
            >
              <option value="all">全部记录</option>
              {Object.entries(outcomes).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <ol className="trace-axis" aria-label="采集记录">
        {ordered.map((row, i) => {
          const at = row.at ? new Date(row.at) : null
          const stamp = at && Number.isFinite(+at) ? at : null
          const day = stamp ? date.format(stamp) : '时间未记录'
          const previous =
            i && ordered[i - 1].at ? new Date(ordered[i - 1].at!) : null
          const open = selected === row.id
          return (
            <li key={row.id}>
              {(!previous ||
                !Number.isFinite(+previous) ||
                day !== date.format(previous)) && (
                <h3 className="trace-day">{day}</h3>
              )}
              <button
                id={'perception-row-' + row.id}
                className="trace-toggle"
                data-kind={row.kind}
                aria-expanded={open}
                aria-controls={open ? 'perception-detail-' + row.id : undefined}
                onClick={() => {
                  focusTarget.current = open ? null : row.id
                  setSelected(open ? null : row.id)
                }}
              >
                <time dateTime={row.at ?? undefined}>
                  {stamp ? clock.format(stamp) : '—'}
                </time>
                <span className="trace-point" aria-hidden>
                  {row.kind === 'message' && <MessageSquareText size={13} />}
                  {row.kind === 'summary' && <NotebookText size={14} />}
                </span>
                <span className="trace-title">
                  <strong>{row.title}</strong>
                  <small>{row.subtitle}</small>
                </span>
                <span className="trace-status">{row.status}</span>
                <ChevronRight size={14} className="trace-chevron" aria-hidden />
              </button>
              {open && (
                <div
                  className="trace-detail"
                  id={'perception-detail-' + row.id}
                >
                  {row.kind !== 'visit' ? (
                    <PerceptionLinks target={row.id} {...navigation} />
                  ) : (
                    <VisitDetails
                      id={row.id}
                      item={row.item}
                      revision={revision}
                      navigation={navigation}
                    />
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {!ordered.length && (
        <p className="stage-note" role="status">
          已加载的记录中没有符合此筛选条件的停留。
        </p>
      )}
    </div>
  )
}
