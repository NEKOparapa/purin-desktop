import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BookOpen, RotateCw } from 'lucide-react'
import type { UserProfileDocument } from '@/lib/desktop'
import initialProfileMarkdown from '../../electron/profile-template.json'

// The published profile uses headings, bullet lists and plain paragraphs.
// Keep any other markup as text; a document cannot inject HTML or load media.
function profileBlocks(markdown: string, initial: boolean) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  let lines: string[] = []
  let emptySection = false
  function endSection() {
    if (initial && emptySection)
      blocks.push(
        <p className="profile-placeholder" key={blocks.length}>
          待补充
        </p>,
      )
  }
  function endList() {
    if (!bullets.length) return
    blocks.push(
      <ul key={blocks.length}>
        {bullets.map((s, i) => (
          <li key={i}>
            {s}
            {initial && /[：:]$/.test(s) && (
              <span className="profile-placeholder">待补充</span>
            )}
          </li>
        ))}
      </ul>,
    )
    bullets = []
  }
  function endParagraph() {
    if (!lines.length) return
    blocks.push(<p key={blocks.length}>{lines.join('\n')}</p>)
    lines = []
  }
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^(#{1,6})\s+(.+)/.exec(line)
    const item = /^[-+*]\s+(.+)/.exec(line)
    if (item) {
      endParagraph()
      emptySection = false
      bullets.push(item[1])
    } else {
      endList()
      if (heading || !line) endParagraph()
      if (heading) {
        endSection()
        emptySection = true
        const Tag = heading[1].length <= 2 ? 'h3' : 'h4'
        const title = heading[2].replace(/\s+#+$/, '').trim()
        blocks.push(<Tag key={blocks.length}>{title}</Tag>)
        if (title === '常用时间段') {
          blocks.push(
            <p key={blocks.length} className="profile-usage">
              仅供后台判断空闲时段
            </p>,
          )
        }
      } else if (line) {
        emptySection = false
        lines.push(line)
      }
    }
  }
  endParagraph()
  endList()
  endSection()
  return blocks
}

function profileStatus(profile: UserProfileDocument) {
  if (profile.status === 'empty')
    return '尚未生效，等待可供主 Agent 使用的资料。'
  if (profile.effective === true)
    return '已生效，主 Agent 将在下次运行时读取有效资料。'
  if (profile.effective === false)
    return '尚未生效，此版本的档案未加入主 Agent 上下文。'
  return '生效状态未知，当前后端尚未提供此信息。'
}

export function UserProfile() {
  const [data, setData] = useState<UserProfileDocument | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const reload = useRef<() => void>(() => {})
  useEffect(() => {
    let active = true
    let busy = false
    async function load() {
      if (!active || busy) return
      busy = true
      setLoading(true)
      setError('')
      try {
        if (!window.wintermute?.userProfile)
          throw new Error('请更新桌面端后查看用户档案。')
        const next = await window.wintermute.userProfile()
        if (active) setData(next)
      } catch (e) {
        if (active) {
          setData(null)
          setError(
            e instanceof Error
              ? e.message.replace(/^.*?Error: /, '')
              : '读取用户档案失败，请重试。',
          )
        }
      } finally {
        busy = false
        if (active) setLoading(false)
      }
    }
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    reload.current = load
    void load()
    const timer = window.setInterval(refreshVisible, 60_000)
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [])
  return (
    <section className="user-profile" aria-labelledby="profile-title">
      <header className="history-tools profile-heading">
        <div>
          <h2 id="profile-title">
            {data?.status === 'empty' ? '初始档案' : '用户档案'}
          </h2>
          {data && data.status !== 'unconfigured' && (
            <p role="status" className="profile-status">
              {profileStatus(data)}
            </p>
          )}
        </div>
        <button
          className="history-refresh"
          disabled={loading}
          onClick={() => reload.current()}
        >
          <RotateCw size={15} aria-hidden="true" />
          刷新
        </button>
      </header>
      {error ? (
        <p role="alert" className="history-error history-status">
          {error}
        </p>
      ) : !data ? (
        <p role="status" className="history-status">
          正在读取用户档案…
        </p>
      ) : data.status !== 'unconfigured' ? (
        <article aria-label="档案内容" className="profile-document">
          {profileBlocks(data.markdown, data.status === 'empty')}
        </article>
      ) : (
        <div role="status" className="history-empty">
          <BookOpen size={22} aria-hidden="true" />
          <p>后端尚未配置用户档案。</p>
        </div>
      )}
      {data?.status === 'ready' && (
        <details className="profile-template">
          <summary>查看初始模板</summary>
          <p className="profile-status">初始模板 · 未生效</p>
          <article aria-label="初始模板内容" className="profile-document">
            {profileBlocks(initialProfileMarkdown, true)}
          </article>
        </details>
      )}
    </section>
  )
}
