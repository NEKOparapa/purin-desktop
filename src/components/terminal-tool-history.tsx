import { useEffect, useState } from 'react'
import { RotateCw, Terminal } from 'lucide-react'
import type { ResultsPage, TerminalToolCall } from '@/lib/desktop'

const statuses: Record<TerminalToolCall['status'], string> = {
  queued: '等待终端领取',
  running: '执行中',
  succeeded: '已成功',
  failed: '执行失败',
  timed_out: '执行超时',
  expired: '已过期',
}

function Time({ at }: { at: string }) {
  return <time dateTime={at}>{new Date(at).toLocaleString('zh-CN', {
    dateStyle: 'short', timeStyle: 'medium', hour12: false,
  })}</time>
}

function CallRecord({ call }: { call: TerminalToolCall }) {
  return (
    <article className="history-entry terminal-call">
      <header>
        <strong>{call.terminal_id}</strong>
        <code>{call.tool}</code>
        <span className="call-status" data-status={call.status}>{statuses[call.status]}</span>
        <Time at={call.created_at} />
      </header>
      {typeof call.arguments.command === 'string'
        ? <pre aria-label="命令">{call.arguments.command}</pre>
        : Object.keys(call.arguments).length > 0 &&
          <pre aria-label="工具参数">{JSON.stringify(call.arguments, null, 2)}</pre>}
      <details>
        <summary>执行详情</summary>
        <dl>
          <div><dt>发起时间</dt><dd><Time at={call.created_at} /></dd></div>
          {call.started_at && <div><dt>开始时间</dt><dd><Time at={call.started_at} /></dd></div>}
          {call.completed_at && <div><dt>结束时间</dt><dd><Time at={call.completed_at} /></dd></div>}
          <div><dt>超时上限</dt><dd>{call.timeout_seconds} 秒</dd></div>
          {call.exit_code !== null && <div><dt>退出码</dt><dd>{call.exit_code}</dd></div>}
        </dl>
        {call.stdout && <section><h3>标准输出</h3><pre>{call.stdout}</pre></section>}
        {call.stderr && <section><h3>标准错误</h3><pre>{call.stderr}</pre></section>}
        {call.completed_at && !call.stdout && !call.stderr && <small>没有输出</small>}
        {call.truncated && <small>输出已截断</small>}
      </details>
    </article>
  )
}

function CallPage({ cursor, older, newer }: {
  cursor?: string
  older: (cursor: string) => void
  newer: () => void
}) {
  const [page, setPage] = useState<ResultsPage<TerminalToolCall> | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    let pending = false
    async function read(interactive = false) {
      if (pending) return
      pending = true
      if (interactive) setLoading(true)
      try {
        const api = window.wintermute
        if (!api?.terminalToolHistory) throw new Error('当前客户端未提供终端调用记录。')
        const result = await api.terminalToolHistory(cursor)
        if (active) {
          setPage(result)
          setError('')
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message.replace(/^.*?Error: /, '') : '读取调用记录失败')
      } finally {
        pending = false
        if (active) setLoading(false)
      }
    }
    function refreshVisible() {
      if (document.visibilityState === 'visible') void read()
    }
    void read(true)
    const timer = window.setInterval(refreshVisible, 5000)
    document.addEventListener('visibilitychange', refreshVisible)
    window.addEventListener('focus', refreshVisible)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshVisible)
      window.removeEventListener('focus', refreshVisible)
    }
  }, [cursor, revision])
  return (
    <section aria-label="终端调用记录">
      <div className="history-tools terminal-call-tools">
        <button className="history-refresh" onClick={() => setRevision(n => n + 1)} disabled={loading}>
          <RotateCw size={14} aria-hidden="true" /> 刷新
        </button>
      </div>
      {error && <p className="history-error history-status" role="alert">{error}</p>}
      {loading && !page && <p className="history-status" role="status">正在读取调用记录…</p>}
      {page && !page.items.length && !error && (
        <div className="history-empty" role="status"><Terminal size={22} aria-hidden="true" />暂无终端调用</div>
      )}
      <ol className="history-records">
        {page?.items.map(call => <li key={call.id}><CallRecord call={call} /></li>)}
      </ol>
      <div className="history-actions terminal-call-pages">
        {cursor && <button onClick={newer}>较新记录</button>}
        {page?.next_cursor && <button onClick={() => older(page.next_cursor!)}>较早记录</button>}
      </div>
    </section>
  )
}

export function TerminalToolHistory() {
  const [positions, setPositions] = useState<string[]>([])
  const cursor = positions.at(-1)
  return <CallPage key={cursor ?? ''} cursor={cursor}
    older={next => setPositions(previous => [...previous, next])}
    newer={() => setPositions(previous => previous.slice(0, -1))}
  />
}
