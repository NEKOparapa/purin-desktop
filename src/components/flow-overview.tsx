import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, RotateCw } from 'lucide-react'
import type {
  ContextPreview,
  PendingTimeline,
  PerceptionDestinationFilter,
  PerceptionSummary,
} from '@/lib/desktop'
import { byteLength, formatBytes, formatBytesShort } from '@/lib/perception'

export type TimeRangePreset = 'today' | '24h' | '7d'

function computeBounds(preset: TimeRangePreset): { from: string; to: string } {
  const now = new Date()
  if (preset === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { from: start.toISOString(), to: end.toISOString() }
  }
  const hours = preset === '24h' ? 24 : 24 * 7
  const start = new Date(now.getTime() - hours * 3600 * 1000)
  return { from: start.toISOString(), to: now.toISOString() }
}

const segmentColors: Record<string, string> = {
  system: 'var(--ctx-system, #5b7cfa)',
  session_summary: 'var(--ctx-summary, #9c6ade)',
  recent_messages: 'var(--ctx-recent, #2f9e44)',
  pending_timeline: 'var(--ctx-pending, #f08c00)',
}

export function ContextPreviewPanel({
  preview,
  loading,
  error,
}: {
  preview?: ContextPreview
  loading: boolean
  error: string
}) {
  if (loading && !preview) {
    return (
      <p className="stage-note" role="status">
        正在估算模型上下文构成…
      </p>
    )
  }
  if (error) {
    return (
      <p className="history-error" role="alert">
        {error}
      </p>
    )
  }
  if (!preview) return null

  const total = Math.max(1, preview.total_bytes)
  return (
    <section className="overview-card" aria-label="模型上下文预览">
      <div className="overview-card-head">
        <div>
          <h3>模型上下文预览</h3>
          <p className="stage-note">
            下一次请求发给模型的完整输入构成（只读预览，不改变已读状态）
          </p>
        </div>
        <div className="overview-card-stat">
          <strong>{formatBytes(preview.total_bytes)}</strong>
          {preview.input_limit !== null && (
            <small>
              上下文预算 {preview.input_limit.toLocaleString('zh-CN')} 字节
            </small>
          )}
        </div>
      </div>

      <div className="context-bar" role="img" aria-label="模型上下文各部分占比">
        {preview.segments.map((seg) => {
          const pct = Math.max(
            seg.bytes > 0 ? 2 : 0,
            Math.round((seg.bytes / total) * 1000) / 10,
          )
          return (
            <div
              key={seg.kind}
              className="context-bar-segment"
              style={{
                width: `${pct}%`,
                background: segmentColors[seg.kind] ?? 'var(--primary)',
              }}
              title={`${seg.label}: ${formatBytes(seg.bytes)}`}
            />
          )
        })}
      </div>

      <ul className="context-segments">
        {preview.segments.map((seg) => {
          const ratio = Math.round((seg.bytes / total) * 100)
          return (
            <li key={seg.kind} className="context-segment-row">
              <div className="context-segment-head">
                <span className="context-segment-title">
                  <i
                    className="context-dot"
                    style={{
                      background: segmentColors[seg.kind] ?? 'var(--primary)',
                    }}
                  />
                  <strong>{seg.label}</strong>
                </span>
                <span className="context-segment-size">
                  {formatBytes(seg.bytes)} · {ratio}%
                </span>
              </div>

              {seg.kind === 'system' && (
                <div className="context-segment-meta">
                  <span>
                    基础提示 {formatBytesShort(seg.base_bytes)} + 用户档案{' '}
                    {seg.profile_present
                      ? formatBytesShort(seg.profile_bytes)
                      : '未配置/为空'}
                  </span>
                  {seg.preview && (
                    <details className="stage-disclosure">
                      <summary>查看系统提示摘录</summary>
                      <pre className="stage-text">{seg.preview}</pre>
                    </details>
                  )}
                </div>
              )}

              {seg.kind === 'session_summary' && (
                <div className="context-segment-meta">
                  <span>
                    {seg.text
                      ? `已摘要前 ${seg.summarized_messages} 条消息（压缩 ${seg.compactions} 次）`
                      : '当前无会话摘要'}
                  </span>
                  {seg.text && (
                    <details className="stage-disclosure">
                      <summary>查看会话摘要</summary>
                      <pre className="stage-text">{seg.text}</pre>
                    </details>
                  )}
                </div>
              )}

              {seg.kind === 'recent_messages' && (
                <div className="context-segment-meta">
                  <span>保留最近 {seg.message_count} 条原始消息</span>
                  {seg.items.length > 0 && (
                    <details className="stage-disclosure">
                      <summary>展开 {seg.message_count} 条最近消息</summary>
                      <ol className="context-recent-list">
                        {seg.items.map((item, idx) => (
                          <li key={idx}>
                            <div className="context-recent-head">
                              <strong>{item.origin || item.role}</strong>
                              <small>{formatBytes(item.bytes)}</small>
                            </div>
                            <p>{item.text}</p>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
              )}

              {seg.kind === 'pending_timeline' && (
                <div className="context-segment-meta">
                  <span>
                    {seg.text
                      ? `单次带入上限 ${seg.budget.toLocaleString('zh-CN')} 字节`
                      : '暂无待带入时间线'}
                  </span>
                  {seg.text && (
                    <details className="stage-disclosure">
                      <summary>查看待带入内容</summary>
                      <pre className="stage-text">{seg.text}</pre>
                    </details>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function FlowOverview({
  pendingLocalCount,
  onFilterPerception,
  revision,
}: {
  pendingLocalCount: number
  onFilterPerception: (
    destination: PerceptionDestinationFilter,
    bounds?: { from: string; to: string },
  ) => void
  revision: number
}) {
  const [preset, setPreset] = useState<TimeRangePreset>('today')
  const [summary, setSummary] = useState<PerceptionSummary>()
  const [pending, setPending] = useState<PendingTimeline>()
  const [preview, setPreview] = useState<ContextPreview>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [previewError, setPreviewError] = useState('')

  const load = useCallback(async () => {
    const api = window.wintermute
    if (!api) return
    setLoading(true)
    setError('')
    setPreviewError('')
    const bounds = computeBounds(preset)
    try {
      const [summaryRes, pendingRes] = await Promise.all([
        api.perceptionSummary
          ? api.perceptionSummary(preset === 'today' ? undefined : bounds)
          : Promise.reject(new Error('当前后端未提供感知数据总览接口。')),
        api.pendingTimeline
          ? api.pendingTimeline()
          : Promise.resolve(undefined),
      ])
      setSummary(summaryRes)
      if (pendingRes) setPending(pendingRes)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^.*?Error: /, '')
          : '读取数据流总览失败。',
      )
    }
    if (api.contextPreview) {
      try {
        const ctx = await api.contextPreview()
        setPreview(ctx)
      } catch (e) {
        setPreviewError(
          e instanceof Error
            ? e.message.replace(/^.*?Error: /, '')
            : '读取上下文预览失败。',
        )
      }
    }
    setLoading(false)
  }, [preset])

  useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [load, revision])

  const activeBounds = preset === 'today' ? undefined : computeBounds(preset)
  const pendingBytes =
    pending?.message?.bytes ??
    (pending?.message?.text ? byteLength(pending.message.text) : summary?.pending_bytes ?? 0)
  const budget = pending?.budget ?? summary?.budget ?? 800
  const bufferRatio = Math.min(100, Math.round((pendingBytes / Math.max(1, budget)) * 100))

  return (
    <div className="flow-overview">
      <div className="overview-toolbar">
        <div className="overview-ranges" role="group" aria-label="统计时间范围">
          {(
            [
              ['today', '今天'],
              ['24h', '最近 24 小时'],
              ['7d', '最近 7 天'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={preset === id}
              onClick={() => setPreset(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="history-refresh"
          onClick={() => void load()}
          disabled={loading}
        >
          <RotateCw size={14} aria-hidden="true" /> 刷新
        </button>
      </div>

      {error && (
        <p className="history-error" role="alert">
          {error}
        </p>
      )}

      {summary && (
        <section className="overview-card" aria-label="感知数据流漏斗">
          <div className="overview-card-head">
            <div>
              <h3>感知 → 上下文 数据流</h3>
              <p className="stage-note">
                点击任意节点数字，可直接在「设备观测」中筛出对应记录
              </p>
            </div>
            {pendingLocalCount > 0 && (
              <span className="flow-pill tone-warn">
                本机待上传 {pendingLocalCount} 条
              </span>
            )}
          </div>

          <div className="funnel-grid">
            <button
              type="button"
              className="funnel-node"
              onClick={() => onFilterPerception('all', activeBounds)}
            >
              <small>① 已上传采集</small>
              <strong>{summary.uploaded.toLocaleString('zh-CN')}</strong>
              <span>原始桌面停留</span>
            </button>

            <ArrowRight className="funnel-arrow" size={16} aria-hidden="true" />

            <div className="funnel-branch">
              <button
                type="button"
                className="funnel-node tone-muted"
                onClick={() => onFilterPerception('filtered', activeBounds)}
              >
                <small>⛔ 已过滤</small>
                <strong>{summary.filtered.toLocaleString('zh-CN')}</strong>
                <span>短停留仅存原始记录</span>
              </button>
              <button
                type="button"
                className="funnel-node tone-info"
                onClick={() => onFilterPerception('kept', activeBounds)}
              >
                <small>② 规则保留</small>
                <strong>{summary.kept.toLocaleString('zh-CN')}</strong>
                <span>
                  {summary.partial > 0 ? `含 ✂️ 部分过滤 ${summary.partial} 条` : '全部标题保留'}
                </span>
              </button>
            </div>

            <ArrowRight className="funnel-arrow" size={16} aria-hidden="true" />

            <button
              type="button"
              className="funnel-node"
              onClick={() => onFilterPerception('kept', activeBounds)}
            >
              <small>③ 时间线文字</small>
              <strong>
                {(summary.observation_lines + summary.visual_lines).toLocaleString('zh-CN')}
              </strong>
              <span>
                观测 {summary.observation_lines} + 截图识别 {summary.visual_lines}
              </span>
            </button>

            <ArrowRight className="funnel-arrow" size={16} aria-hidden="true" />

            <div className="funnel-branch">
              <button
                type="button"
                className="funnel-node tone-accent"
                onClick={() => onFilterPerception('summarized', activeBounds)}
              >
                <small>🧠 已并入摘要</small>
                <strong>{summary.round_count.toLocaleString('zh-CN')} 轮</strong>
                <span>覆盖 {summary.summarized_events} 条观测</span>
              </button>
              <button
                type="button"
                className="funnel-node tone-info"
                onClick={() => onFilterPerception('buffered', activeBounds)}
              >
                <small>⏳ 缓冲中</small>
                <strong>{summary.buffered_events.toLocaleString('zh-CN')} 条</strong>
                <span>
                  {formatBytesShort(summary.pending_bytes)} / {formatBytesShort(summary.budget)}
                </span>
              </button>
            </div>

            <ArrowRight className="funnel-arrow" size={16} aria-hidden="true" />

            <button
              type="button"
              className="funnel-node tone-ok"
              onClick={() => onFilterPerception('delivered', activeBounds)}
            >
              <small>⑤ 已进入上下文</small>
              <strong>{summary.delivered_events.toLocaleString('zh-CN')} 条</strong>
              <span>{summary.delivery_runs} 次对话带入</span>
            </button>
          </div>
        </section>
      )}

      <section className="overview-card" aria-label="下次对话会带入的时间线">
        <div className="overview-card-head">
          <div>
            <h3>下次对话会带入的「活动时间线」</h3>
            <p className="stage-note">
              单次带入上限 {budget.toLocaleString('zh-CN')} 字节（超出时后端后台自动滚动摘要）
            </p>
          </div>
          <div className="overview-card-stat">
            <strong>{formatBytes(pendingBytes)}</strong>
            <small>
              {pendingBytes.toLocaleString('zh-CN')} / {budget.toLocaleString('zh-CN')} 字节（{bufferRatio}%）
            </small>
          </div>
        </div>
        <div className="buffer-meter" aria-hidden="true">
          <div className="buffer-meter-fill" style={{ width: `${bufferRatio}%` }} />
        </div>
        {pending?.message?.text ? (
          <pre className="stage-text">{pending.message.text}</pre>
        ) : (
          <p className="stage-note">当前没有尚未读取的活动时间线。</p>
        )}
      </section>

      <ContextPreviewPanel
        preview={preview}
        loading={loading}
        error={previewError}
      />
    </div>
  )
}
