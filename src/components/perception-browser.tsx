import { Fragment, useEffect, useState } from 'react'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import type { HistoryItem, PerceptionStages } from '@/lib/desktop'
import { perceptionLabel } from '@/lib/perception'
import { PerceptionRecord } from './perception-record'
import { CompressionBrowser } from './compression-browser'

const stages = ['原始信息', '过滤筛选', '规则压缩', '格式排版', 'AI 压缩'] as const
type Stage = (typeof stages)[number]
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

function RuleResult({ data, filterStage }: { data: PerceptionStages; filterStage: boolean }) {
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
      {filterStage && (
        <p className="stage-note">
          {data.retained === null
            ? `应用停留未超过 ${threshold} 秒，整条记录仅保存在原始信息中。`
            : removed
              ? '应用停留已保留，以下短标题从后续的时间线文字中移除。'
              : data.decisions.length ? '本次采集未触发短停留规则。' : '此观测不含需要筛选的应用停留。'}
        </p>
      )}
      {data.decisions.length > 0 && (!filterStage || removed > 0) && (
        <>
          {!filterStage && <p className="stage-note">应用或窗口标题停留 {threshold} 秒及以内会被过滤。</p>}
          <table className="rule-decisions">
            <thead>
              <tr>
                <th>工作对象</th>
                <th>停留</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {data.decisions.filter(row => !filterStage || !row.kept).map((row, index) => (
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
                  <td>{row.kept ? `保留（超过 ${threshold} 秒）` : `过滤（${threshold} 秒及以内）`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {!filterStage && data.retained !== null && (
        <details className="stage-disclosure" open={!data.decisions.length}>
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
  openTimeline,
}: {
  data: PerceptionStages
  openTimeline: () => void
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
          {data.parts.length > 1 && <p className="stage-note">本轮纳入{data.parts
            .filter(part => part.round_id === round.id)
            .map(part => part.kind === 'visual' ? '截图识别补充' : '观测记录').join('、')}</p>}
          {round.summary && <p className="stage-summary">{round.summary}</p>}
          <p className="stage-note">
            本轮输入 {size(round.input)}
            {round.summary ? ` → 输出 ${size(round.summary)}` : ''} 估算单位
          </p>
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
      <button className="history-inline stage-link" onClick={openTimeline}>
        查看已投递的时间线 <ArrowUpRight size={14} aria-hidden />
      </button>
    </>
  )
}

function Processing({
  id,
  stage,
  openTimeline,
  revision,
}: {
  id: string
  stage: Exclude<Stage, '原始信息'>
  openTimeline: () => void
  revision: number
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
        const result = await api.compression({ kind: 'stages', id })
        if (current) {
          setData(result)
          setError('')
        }
      } catch (e) {
        if (current)
          setError(
            e instanceof Error
              ? e.message.replace(/^.*?Error: /, '')
              : '读取压缩过程失败。',
          )
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
  }, [id, retry, revision])
  if (error)
    return (
      <>
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
          <CompressionBrowser layer="perception" openTimeline={openTimeline} />
        )}
      </>
    )
  if (!data)
    return (
      <p className="stage-note" role="status">
        正在读取处理记录…
      </p>
    )
  if (stage === '过滤筛选' || stage === '规则压缩')
    return <RuleResult data={data} filterStage={stage === '过滤筛选'} />
  if (stage === '格式排版') return <Formatted data={data} />
  return <AIResult data={data} openTimeline={openTimeline} />
}

export function PerceptionBrowser({
  items,
  openTimeline,
  revision,
}: {
  items: HistoryItem[]
  openTimeline: () => void
  revision: number
}) {
  const [selected, setSelected] = useState(items[0]?.id)
  const [stage, setStage] = useState<Stage>('原始信息')
  const [outcome, setOutcome] = useState('all')
  const hasOutcomes = items.some(item => item.filter_result)
  const matches = !hasOutcomes || outcome === 'all' ? items : items.filter(item => item.filter_result === outcome)
  const active = matches.find(item => item.id === selected) ?? matches[0]
  const info = active && perceptionLabel(active)
  const records = matches.map((item) => {
    const instant = item.occurred_at ? new Date(item.occurred_at) : null
    const ts = instant && Number.isFinite(+instant) ? instant : null
    return { item, ts, day: ts ? date.format(ts) : '时间未记录' }
  })
  return (
    <div className="perception-workspace">
      <nav className="perception-index" aria-label="采集记录">
        <label className="perception-outcome">
          过滤结果（已加载记录）
          <select aria-label="按过滤结果筛选" value={hasOutcomes ? outcome : 'all'} disabled={!hasOutcomes} onChange={event => setOutcome(event.target.value)}>
            <option value="all">全部记录</option>
            {Object.entries(outcomes).map(([key, label]) =>
              <option key={key} value={key}>{label}</option>)}
          </select>
          {!hasOutcomes && <small>更新后端后可按结果筛选</small>}
        </label>
        {records.map(({ item, ts, day }, index) => {
          const heading = day !== records[index - 1]?.day
          const label = perceptionLabel(item)
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
                  {[label.subject || label.source, label.duration, item.filter_result && outcomes[item.filter_result]]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </button>
            </Fragment>
          )
        })}
      </nav>
      {active && info ? <article
        className="perception-inspect"
        aria-label={info.title + '的压缩过程'}
      >
        <header>
          <small>{info.source}</small>
          <h2>{info.title}</h2>
        </header>
        <div className="perception-steps" role="group" aria-label="压缩过程">
          {stages.map((name, i) => (
            <Fragment key={name}>
              {i > 0 && <ChevronRight size={13} aria-hidden />}
              <button
                aria-pressed={name === stage}
                onClick={() => setStage(name)}
              >
                {name}
              </button>
            </Fragment>
          ))}
        </div>
        <div className="perception-stage" key={active.id}>
          {stage === '原始信息' ? (
            <PerceptionRecord item={active} />
          ) : (
            <Processing
              id={active.id}
              revision={revision}
              stage={stage}
              openTimeline={openTimeline}
            />
          )}
        </div>
      </article> : <p className="stage-note" role="status">已加载的记录中没有符合此筛选条件的停留。</p>}
    </div>
  )
}
