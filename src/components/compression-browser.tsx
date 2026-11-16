import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronRight, RotateCw } from 'lucide-react'
import type {
  ActivityLayer,
  CompressionBatch,
  CompressionDetail,
  CompressionStatus,
  OriginalDetail,
  ResultsPage,
  BatchObservation,
  OriginalRecord,
} from '@/lib/desktop'
import { Files } from './history-files'

const statuses: Record<CompressionStatus, string> = {
  open: '收集中',
  rules: '规则压缩完成',
  pending: '等待 AI 摘要',
  ready: 'AI 摘要已生成',
  retrying: 'AI 摘要等待重试',
  disabled: 'AI 摘要已关闭',
}
const aiStates: Record<CompressionStatus, string> = {
  open: '本批仍在收集活动',
  rules: '规则摘要已满足长度预算',
  pending: '等待后台生成摘要',
  ready: '暂无已保存的 AI 摘要',
  retrying: '生成失败，等待后台重试',
  disabled: 'AI 摘要已关闭',
}
const extractionStates: Record<OriginalDetail['extraction']['status'], string> =
  {
    ready: '已提取',
    pending: '等待处理',
    retrying: '等待重试',
    no_change: '这次采集没有新增事实',
    not_recorded: '没有已保存的提取结果',
  }
const strategies: Record<string, string> = {
  image_description: '截图识别',
  audio_asr_model: '录音转写与摘要',
  rule: '规则提取',
  model: '模型提取',
}
const dates = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' })
const times = new Intl.DateTimeFormat('zh-CN', {
  timeStyle: 'medium',
  hour12: false,
})
function timeRange(start: string, end: string) {
  const from = new Date(start),
    to = new Date(end)
  if (!Number.isFinite(+from) || !Number.isFinite(+to)) return ''
  return (
    dates.format(from) +
    '  ' +
    times.format(from) +
    (start === end
      ? ''
      : ' – ' +
        (dates.format(from) === dates.format(to)
          ? ''
          : dates.format(to) + ' ') +
        times.format(to))
  )
}
function client() {
  if (!window.wintermute?.compression)
    throw new Error('请在新版桌面应用中连接后端。')
  return window.wintermute
}

type WithId = { id: string }
function usePages<T extends WithId, P extends ResultsPage<T>>(
  fetch: (cursor?: string) => Promise<P>,
) {
  const [page, setPage] = useState<P | null>(null)
  const [items, setItems] = useState<T[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [failedCursor, setFailedCursor] = useState<string>()
  const request = useRef<symbol | null>(null)
  const fetchPage = useCallback(
    async (cursor?: string) => {
      if (request.current) return
      const token = Symbol()
      request.current = token
      try {
        const result = await fetch(cursor)
        if (request.current !== token) return
        setPage(result)
        setItems((previous) => {
          const rows = new Map<string, T>()
          if (cursor) for (const item of previous) rows.set(item.id, item)
          for (const item of result.items) rows.set(item.id, item)
          return [...rows.values()]
        })
      } catch (e) {
        if (request.current !== token) return
        setFailedCursor(cursor)
        setError(
          e instanceof Error
            ? e.message.replace(/^.*?Error: /, '')
            : '读取失败，请重试。',
        )
      } finally {
        if (request.current === token) {
          request.current = null
          setBusy(false)
        }
      }
    },
    [fetch],
  )
  function read(cursor?: string) {
    if (request.current) return
    setBusy(true)
    setError('')
    void fetchPage(cursor)
  }
  useEffect(() => {
    let mounted = true
    queueMicrotask(() => {
      if (mounted) void fetchPage()
    })
    return () => {
      mounted = false
      request.current = null
    }
  }, [fetchPage])
  return {
    page,
    items,
    busy,
    error,
    next: page?.next_cursor,
    failedCursor,
    read,
  }
}
interface PageControls {
  busy: boolean
  error: string
  next?: string | null
  failedCursor?: string
  read: (cursor?: string) => void
  more: string
}
function Navigation({
  busy,
  error,
  next,
  failedCursor,
  read,
  more,
}: PageControls) {
  if (busy)
    return (
      <p role="status" className="history-status">
        正在读取…
      </p>
    )
  if (error)
    return (
      <div className="history-actions">
        <p className="history-error" role="alert">
          {error}
        </p>
        <button onClick={() => read(failedCursor)}>重试</button>
      </div>
    )
  return next ? (
    <div className="history-actions">
      <button onClick={() => read(next)}>{more}</button>
    </div>
  ) : null
}
type OriginalProps = { id: string; layer: ActivityLayer; activity?: boolean }
export function OriginalData({
  id,
  layer,
  activity,
  rawOnly = false,
}: OriginalProps & { rawOnly?: boolean }) {
  const fetch = useCallback(
    (cursor?: string) =>
      client().compression({ kind: 'source', id, activity, cursor }),
    [id, activity],
  )
  const result = usePages<OriginalRecord, OriginalDetail>(fetch)
  const extraction = result.page?.extraction
  return (
    <div className="compression-source">
      {result.items.map((record) => (
        <section key={record.id} className="compression-source-record">
          <h5>
            原始事件 <span>{record.kind}</span>
          </h5>
          <div className="compression-meta">
            {record.source} ·{' '}
            {timeRange(record.occurred_at, record.occurred_at)}
          </div>
          <pre>{JSON.stringify(record.payload, null, 2)}</pre>
          {record.transcript !== null && (
            <>
              <h5>原始转录</h5>
              <p>{record.transcript || '转录为空'}</p>
            </>
          )}
          <Files files={record.files} />
        </section>
      ))}
      {!result.busy && !result.error && !result.items.length && (
        <p>暂无原始资料</p>
      )}
      {extraction && !rawOnly && (
        <section>
          <h5>{layer === 'slice' ? '切片提取结果' : '感知活动文字'}</h5>
          {(extraction.strategy || extraction.source_count > 1) && (
            <div className="compression-meta">
              {[
                extraction.strategy &&
                  (strategies[extraction.strategy] ?? extraction.strategy),
                extraction.source_count > 1 &&
                  `合并 ${extraction.source_count} 条原始记录`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          )}
          {extraction.text && <p>{extraction.text}</p>}
          {(!extraction.text || extraction.status !== 'ready') && (
            <small>{extractionStates[extraction.status]}</small>
          )}
        </section>
      )}
      <Navigation {...result} more="加载更多原始资料" />
    </div>
  )
}

export function OriginalDisclosure(props: OriginalProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="original-disclosure">
      <button
        className="history-inline"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={13} aria-hidden />
        {open ? '收起原始资料' : '查看原始资料'}
      </button>
      {open && <OriginalData {...props} />}
    </div>
  )
}

function Comparison({ id, summaryOnly }: { id: string; summaryOnly: boolean }) {
  const fetch = useCallback(
    (cursor?: string) => client().compression({ kind: 'batch', id, cursor }),
    [id],
  )
  const result = usePages<BatchObservation, CompressionDetail>(fetch)
  const data = result.page
  return (
    <div
      className={summaryOnly ? 'compression-summary' : 'compression-columns'}
    >
      {!summaryOnly && (
        <section aria-label="压缩前">
          <h4>压缩前 · 活动输入</h4>
          <ol className="compression-inputs">
            {result.items.map((item) => (
              <li key={item.id}>
                <div className="compression-meta">
                  {item.source} ·{' '}
                  <time dateTime={item.occurred_at}>
                    {timeRange(item.occurred_at, item.occurred_at)}
                  </time>
                </div>
                <p>{item.text}</p>
                {item.source_count > 0 && (
                  <OriginalDisclosure
                    id={item.id}
                    layer={item.layer}
                    activity
                  />
                )}
              </li>
            ))}
          </ol>
          <Navigation {...result} more="加载更多活动输入" />
        </section>
      )}
      {summaryOnly && <Navigation {...result} next={null} more="" />}
      {data && (
        <section aria-label="压缩后">
          {!summaryOnly && <h4>压缩后</h4>}
          {data.batch.partial ? (
            <p className="compression-note">
              {summaryOnly
                ? '此批次仅部分记录对本会话可见，摘要不可见。'
                : '此批次仅部分记录对本会话可见，仅展示本会话的输入。'}
            </p>
          ) : (
            <>
              <h5>规则摘要</h5>
              <p>{data.rule_text ?? '暂无规则摘要'}</p>
              <h5>AI 摘要</h5>
              <p>{data.ai_text ?? aiStates[data.batch.status]}</p>
              {data.rollup && (
                <details className="compression-rollup">
                  <summary>跨批次汇总</summary>
                  <h5>规则摘要</h5>
                  <p>{data.rollup.rule_text ?? '暂无规则摘要'}</p>
                  <h5>AI 摘要</h5>
                  <p>{data.rollup.ai_text ?? aiStates[data.rollup.status]}</p>
                </details>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
export function CompressionBrowser({
  layer,
  openTimeline,
}: {
  layer: ActivityLayer
  openTimeline: () => void
}) {
  const fetch = useCallback(
    (cursor?: string) => client().compression({ kind: 'list', layer, cursor }),
    [layer],
  )
  const result = usePages<CompressionBatch, ResultsPage<CompressionBatch>>(
    fetch,
  )
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <section
      className="history-list"
      aria-label={layer === 'perception' ? '压缩信息' : '压缩对照'}
    >
      <div className="history-tools">
        <button className="history-inline" onClick={openTimeline}>
          查看已投递的时间线
        </button>
        <button
          className="history-refresh"
          disabled={result.busy}
          onClick={() => {
            setSelected(null)
            void result.read()
          }}
        >
          <RotateCw size={14} aria-hidden /> 刷新
        </button>
      </div>
      {result.items.map((batch) => (
        <article className="compression-entry" key={batch.id}>
          <button
            className="compression-toggle"
            aria-expanded={selected === batch.id}
            onClick={() => setSelected(selected === batch.id ? null : batch.id)}
          >
            <ChevronRight size={16} aria-hidden />
            <span>
              <strong>{timeRange(batch.started_at, batch.ended_at)}</strong>
              <small>
                {batch.terminal_id} ·{' '}
                {[
                  batch.perception_count > 0 &&
                    '感知 ' + batch.perception_count + ' 条',
                  batch.slice_count > 0 && '切片 ' + batch.slice_count + ' 条',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </span>
            <span className="compression-state">
              {batch.partial ? '部分可见' : statuses[batch.status]}
            </span>
          </button>
          {selected === batch.id && (
            <Comparison id={batch.id} summaryOnly={layer === 'perception'} />
          )}
        </article>
      ))}
      {!result.items.length && !result.busy && !result.error && (
        <div className="history-empty" role="status">
          <BookOpen size={22} aria-hidden />
          暂无压缩批次
        </div>
      )}
      <Navigation {...result} more="加载更早批次" />
    </section>
  )
}
