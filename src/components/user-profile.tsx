import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BookOpen, RotateCw } from 'lucide-react'
import type { UserProfileDocument } from '@/lib/desktop'

// The published profile uses headings, bullet lists and plain paragraphs.
// Keep any other markup as text; a document cannot inject HTML or load media.
function profileBlocks(markdown: string) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  let lines: string[] = []
  function endList() {
    if (!bullets.length) return
    blocks.push(
      <ul key={blocks.length}>
        {bullets.map((s, i) => (
          <li key={i}>{s}</li>
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
      bullets.push(item[1])
    } else {
      endList()
      if (heading || !line) endParagraph()
      if (heading) {
        const Tag = heading[1].length <= 2 ? 'h3' : 'h4'
        blocks.push(<Tag key={blocks.length}>{heading[2]}</Tag>)
      } else if (line) lines.push(line)
    }
  }
  endParagraph()
  endList()
  return blocks
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
        <h2 id="profile-title">用户档案</h2>
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
      ) : data.status === 'ready' ? (
        <article aria-label="档案内容" className="profile-document">
          {profileBlocks(data.markdown)}
        </article>
      ) : (
        <div role="status" className="history-empty">
          <BookOpen size={22} aria-hidden="true" />
          <p>
            {data.status === 'unconfigured'
              ? '后端尚未配置用户档案。'
              : '档案暂无内容，后台整理交流记录后会显示在这里。'}
          </p>
        </div>
      )}
    </section>
  )
}
