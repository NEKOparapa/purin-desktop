import { useState } from 'react'
import { ArrowUpRight, ChevronDown, ChevronRight, Layers } from 'lucide-react'
import type { TimelineSources as TimelineSourcesData } from '@/lib/desktop'
import { formatBytes } from '@/lib/perception'

const clock = new Intl.DateTimeFormat('zh-CN', {
  timeStyle: 'medium',
  hour12: false,
})

function shortTime(value?: string | null) {
  if (!value) return ''
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  return clock.format(new Date(ms))
}

export function TimelineSources({
  messageId,
  onSelectPerception,
}: {
  messageId: string
  onSelectPerception: (eventId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<TimelineSourcesData>()

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || data || loading) return
    const api = window.wintermute
    if (!api?.timelineSources) {
      setError('当前桌面端或后端不支持拆解时间线来源。')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await api.timelineSources({ id: messageId })
      setData(result)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^.*?Error: /, '')
          : '读取时间线来源失败。',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="timeline-sources">
      <button
        type="button"
        className="history-inline timeline-sources-toggle"
        aria-expanded={open}
        onClick={() => void toggle()}
      >
        <Layers size={14} aria-hidden="true" />
        拆解来源
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="timeline-sources-panel">
          {loading && (
            <p className="stage-note" role="status">
              正在拆解时间线来源…
            </p>
          )}
          {error && (
            <p className="history-error" role="alert">
              {error}
            </p>
          )}
          {data && (
            <>
              <div className="timeline-sources-summary">
                <span>
                  共 {data.counts.total_activities} 条活动：
                  {data.counts.summary_count > 0 &&
                    ` 摘要 ${data.counts.summary_count} 轮 ·`}
                  {` 感知 ${data.counts.perception_count} 条 · 切片 ${data.counts.slice_count} 条`}
                </span>
                <small>{formatBytes(data.message.bytes)}</small>
              </div>
              <ul className="timeline-sources-list">
                {data.parts.map((part, index) => {
                  if (part.kind === 'note') {
                    return (
                      <li key={`note-${index}`} className="source-chip source-note">
                        <div className="source-chip-head">
                          <strong>修订提示</strong>
                          <small>{formatBytes(part.bytes)}</small>
                        </div>
                        <p>{part.text}</p>
                      </li>
                    )
                  }
                  if (part.kind === 'perception_summary') {
                    return (
                      <li
                        key={`summary-${part.round_id}-${index}`}
                        className="source-chip source-summary"
                      >
                        <div className="source-chip-head">
                          <strong>
                            🧠 感知摘要 R{part.round_id}（覆盖 {part.member_count} 条）
                          </strong>
                          <small>{formatBytes(part.bytes)}</small>
                        </div>
                        <p>{part.summary}</p>
                        {part.members.length > 0 && (
                          <details className="stage-disclosure">
                            <summary>查看所含 {part.members.length} 条观测</summary>
                            <ol className="round-members-list">
                              {part.members.map((member) => (
                                <li key={member.activity_id}>
                                  <time dateTime={member.occurred_at ?? undefined}>
                                    {shortTime(member.occurred_at)}
                                  </time>
                                  <span>{member.text}</span>
                                  <button
                                    type="button"
                                    className="history-inline"
                                    onClick={() => onSelectPerception(member.event_id)}
                                  >
                                    跳回记录 <ArrowUpRight size={13} aria-hidden />
                                  </button>
                                </li>
                              ))}
                            </ol>
                          </details>
                        )}
                      </li>
                    )
                  }
                  if (part.kind === 'perception_line') {
                    return (
                      <li
                        key={`line-${part.activity_id}-${index}`}
                        className="source-chip source-raw"
                      >
                        <div className="source-chip-head">
                          <strong>
                            {part.line_kind === 'visual' ? '🖼️ 截图识别补充' : '📝 原始观测行'}
                            {part.occurred_at ? ` · ${shortTime(part.occurred_at)}` : ''}
                          </strong>
                          <small>{formatBytes(part.bytes)}</small>
                        </div>
                        <p>{part.text}</p>
                        <button
                          type="button"
                          className="history-inline"
                          onClick={() => onSelectPerception(part.event_id)}
                        >
                          跳回设备观测 <ArrowUpRight size={13} aria-hidden />
                        </button>
                      </li>
                    )
                  }
                  return (
                    <li
                      key={`slice-${part.activity_id}-${index}`}
                      className="source-chip source-slice"
                    >
                      <div className="source-chip-head">
                        <strong>
                          📎 切片{part.summarized ? '（AI 批次摘要）' : ''} · {part.source}
                          {part.occurred_at ? ` · ${shortTime(part.occurred_at)}` : ''}
                        </strong>
                        <small>{formatBytes(part.bytes)}</small>
                      </div>
                      <p>{part.text}</p>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
