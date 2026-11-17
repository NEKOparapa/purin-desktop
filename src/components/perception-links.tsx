import { useCallback } from 'react'
import type {
  ContextMessageRef,
  SummaryRoundRef,
  TraceMember,
  TracePage,
} from '@/lib/desktop'
import { usePages } from '@/lib/use-pages'
import { Navigation, OriginalDisclosure } from './compression-browser'

export type TraceNavigation = {
  openMember: (member: TraceMember) => void
  openMessage: (message: ContextMessageRef) => void
  openSummary: (round: SummaryRoundRef, summary: string) => void
}

export function PerceptionLinks({
  target,
  message,
  eventId,
  openMember,
  openMessage,
}: TraceNavigation & {
  target: string
  message?: ContextMessageRef
  eventId?: string
}) {
  const fetch = useCallback(
    (cursor?: string) => {
      if (!window.wintermute?.compression) throw new Error('无法连接后端。')
      return window.wintermute.compression({
        kind: 'trace',
        id: target,
        cursor,
      })
    },
    [target],
  )
  const result = usePages<TraceMember, TracePage>(fetch)
  const page = result.page
  const round = target.startsWith('round-')
  return (
    <section className="trace-group">
      {page && (
        <>
          {round && !eventId && page.round && (
            <>
              <h4>AI 摘要原文</h4>
              <pre className="stage-text">{page.round.summary}</pre>
              <details className="stage-disclosure">
                <summary>查看本轮完整输入</summary>
                <pre className="stage-text">{page.round.input}</pre>
              </details>
            </>
          )}
          <h4>{round ? '本轮合并的新增记录' : '这条消息同次处理的记录'}</h4>
          {round && !result.items.length && (
            <p className="stage-note">本轮只压缩了已有摘要。</p>
          )}
          <ul className="trace-members">
            {result.items.map((member) => {
              const label = [
                new Date(member.occurred_at).toLocaleString('zh-CN', {
                  hour12: false,
                }),
                member.terminal,
                member.title,
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <li key={member.id}>
                  {member.event_id === eventId ? (
                    <span>{label}（本条）</span>
                  ) : member.event_id ? (
                    <button
                      className="history-inline"
                      onClick={() => openMember(member)}
                    >
                      {label} ↗
                    </button>
                  ) : (
                    <>
                      <span>{label}</span>
                      <OriginalDisclosure
                        layer="slice"
                        id={member.id}
                        activity
                      />
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      <Navigation {...result} more="更多关联记录" />
      {page?.text != null && (
        <>
          <h4>写入上下文的整段原文</h4>
          <pre className="stage-text">{page.text}</pre>
          {message && (
            <button
              className="history-inline"
              onClick={() => openMessage(message)}
            >
              定位这条时间线消息 ↗
            </button>
          )}
        </>
      )}
    </section>
  )
}
