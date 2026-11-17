import { Fragment, useEffect, useState } from 'react'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import type { HistoryItem, PerceptionStages } from '@/lib/desktop'
import { perceptionLabel } from '@/lib/perception'
import { PerceptionRecord } from './perception-record'
import { CompressionBrowser } from './compression-browser'

const stages = ['原始信息', '规则压缩', '格式排版', 'AI 压缩'] as const
type Stage = (typeof stages)[number]
const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' })
const clock = new Intl.DateTimeFormat('zh-CN', {
  timeStyle: 'medium',
  hour12: false,
})
const size = (text: string) =>
  new TextEncoder().encode(text).length.toLocaleString('zh-CN')

function RuleResult({ data }: { data: PerceptionStages }) {
  if (!data.parts.length)
    return <p className="stage-note">这次上报没有在本会话形成新的活动记录。</p>
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
          <p className="stage-note">应用或窗口标题停留 3 秒及以内会被过滤。</p>
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
                  <td>{row.kept ? '保留' : '过滤'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {data.retained !== null && (
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
  if (stage === '规则压缩') return <RuleResult data={data} />
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
  const active = items.find((item) => item.id === selected) ?? items[0]
  if (!active) return null
  const info = perceptionLabel(active)
  const records = items.map((item) => {
    const instant = item.occurred_at ? new Date(item.occurred_at) : null
    const ts = instant && Number.isFinite(+instant) ? instant : null
    return { item, ts, day: ts ? date.format(ts) : '时间未记录' }
  })
  return (
    <div className="perception-workspace">
      <nav className="perception-index" aria-label="采集记录">
        {records.map(({ item, ts, day }, index) => {
          const heading = day !== records[index - 1]?.day
          const label = perceptionLabel(item)
          return (
            <Fragment key={item.id}>
              {heading && <h2>{day}</h2>}
              <button
                className="perception-choice"
                aria-pressed={item.id === active.id}
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
              </button>
            </Fragment>
          )
        })}
      </nav>
      <article
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
      </article>
    </div>
  )
}
