import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarDays,
  BookOpen,
  CornerDownLeft,
  History,
  ListChecks,
  MessageCircle,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { AgentSettings } from '@/components/agent-settings'
import { ScheduleCalendar } from '@/components/schedule-calendar'
import { NotificationInbox } from '@/components/notification-inbox'
import type { NoticeAlert } from '@/lib/desktop'
import { MemoryBrowser } from '@/components/memory-browser'
import { useAgent, type AgentState, type ChatMessage } from '@/lib/desktop'
import './App.css'

const pages = [
  { id: 'chat', label: '对话', icon: MessageCircle },
  { id: 'memory', label: '记忆', icon: BookOpen },
  { id: 'schedule', label: '日程', icon: CalendarDays },
] as const
type Page = (typeof pages)[number]['id']
const sidebarPreference = 'wintermute.sidebarCollapsed'

function initialSidebarCollapsed() {
  try {
    const saved = localStorage.getItem(sidebarPreference)
    if (saved !== null) return saved === 'true'
  } catch {
    // Layout still works when browser storage is unavailable.
  }
  return window.matchMedia('(max-width: 750px)').matches
}
const prompts = [
  { label: '回顾今天', text: '帮我回顾一下今天的活动。', icon: History },
  {
    label: '整理会议',
    text: '帮我整理最近一次会议的决定和下一步行动。',
    icon: NotebookPen,
  },
  {
    label: '梳理待办',
    text: '根据我们最近聊过的事，帮我梳理接下来的待办。',
    icon: ListChecks,
  },
]
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
})
const statuses = {
  queued: '正在发送',
  waiting: '等待回复',
  failed: '处理失败',
  interrupted: '处理已中断',
  missing: '原任务已失效',
  unsent: '发送未确认',
  completed: '',
}

function Mark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      {[7, 14, 20, 12, 8].map((h) => (
        <i key={h} style={{ height: h + 'px' }} />
      ))}
    </span>
  )
}

function Message({
  message,
  retry,
}: {
  message: ChatMessage
  retry: (id: string) => void
}) {
  const user = message.role === 'user'
  const notice = message.notificationReply
  return (
    <article className={'message ' + (notice ? 'notification' : message.role)}>
      <header>
        {notice ? <Bell size={14} /> : !user && <Mark />}
        <strong>
          {user ? '你' : notice ? 'Wintermute · 通知回复' : 'Wintermute'}
        </strong>
        {message.at && (
          <time dateTime={message.at}>
            {timeFormat.format(new Date(message.at))}
          </time>
        )}
      </header>
      <p>{message.text}</p>
      {message.status && statuses[message.status] && (
        <footer>
          {statuses[message.status]} {message.error}
          {['unsent', 'failed', 'interrupted', 'missing'].includes(
            message.status,
          ) && (
            <button onClick={() => retry(message.id)}>
              {message.status === 'unsent' ? '重试发送' : '重新提问'}
            </button>
          )}
        </footer>
      )}
    </article>
  )
}

function Chat({
  agent,
  settings,
  visible,
}: {
  agent: AgentState
  settings: () => void
  visible: boolean
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [issue, setIssue] = useState('')
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const follow = useRef(true)
  const log = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const lastMessageId = agent.messages.at(-1)?.id
  const hasMessages = agent.messages.length > 0 || agent.hasEarlier
  const olderAnchor = useRef<{ height: number; position: number } | null>(null)
  async function earlier() {
    if (loadingEarlier || !log.current || !window.wintermute) return
    olderAnchor.current = {
      height: log.current.scrollHeight,
      position: log.current.scrollTop,
    }
    follow.current = false
    setLoadingEarlier(true)
    setIssue('')
    try {
      await window.wintermute.loadEarlier()
    } catch {
      setIssue('无法读取更早消息，请重试。')
    } finally {
      setLoadingEarlier(false)
    }
  }
  useLayoutEffect(() => {
    if (!loadingEarlier && olderAnchor.current && log.current) {
      const anchor = olderAnchor.current
      log.current.scrollTop =
        anchor.position + log.current.scrollHeight - anchor.height
      olderAnchor.current = null
    } else if (visible && follow.current && log.current)
      log.current.scrollTop = log.current.scrollHeight
  }, [agent.messages.length, lastMessageId, visible, loadingEarlier])
  useLayoutEffect(() => {
    if (visible && input.current) {
      input.current.style.height = 'auto'
      input.current.style.height =
        Math.min(150, input.current.scrollHeight) + 'px'
    }
  }, [draft, visible])
  async function send() {
    if (sending || !draft.trim()) return
    if (!agent.configured || !window.wintermute) {
      settings()
      return
    }
    setSending(true)
    setIssue('')
    follow.current = true
    const text = draft
    try {
      await window.wintermute.send(text)
      setDraft((current) => (current === text ? '' : current))
    } catch {
      setIssue('这条消息尚未保存，请重试。')
    } finally {
      setSending(false)
      input.current?.focus()
    }
  }
  function retry(id: string) {
    window.wintermute?.retry(id).catch(() => setIssue('重试失败，请检查连接。'))
  }
  const status =
    issue || (agent.issue && '连接异常，将自动重试 · ' + agent.issue)
  return (
    <section
      className={'chat ' + (hasMessages ? 'with-messages' : 'empty-chat')}
      aria-label="与 Wintermute 对话"
    >
      {hasMessages ? (
        <>
          <div
            className="message-scroller"
            ref={log}
            role="log"
            aria-label="消息记录"
            onScroll={() => {
              const el = log.current
              if (!el) return
              follow.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 64
              setAtBottom(follow.current)
            }}
          >
            <div className="thread">
              {agent.hasEarlier && (
                <button
                  className="earlier-messages"
                  disabled={loadingEarlier}
                  onClick={earlier}
                >
                  {loadingEarlier ? '正在读取…' : '加载更早消息'}
                </button>
              )}
              {agent.messages.map((message, i) => {
                const day = message.at ? new Date(message.at) : null
                const previous = agent.messages[i - 1]?.at
                const newDate =
                  day &&
                  (!previous ||
                    day.toDateString() !== new Date(previous).toDateString())
                return (
                  <div key={message.id}>
                    {day && newDate && (
                      <p className="day-divider">
                        <span>{dateFormat.format(day)}</span>
                      </p>
                    )}
                    <Message message={message} retry={retry} />
                  </div>
                )
              })}
            </div>
          </div>
          {!atBottom && (
            <button
              className="jump-to-end"
              onClick={() => {
                if (log.current)
                  log.current.scrollTop = log.current.scrollHeight
              }}
            >
              <ArrowDown size={14} />
              最新消息
            </button>
          )}
        </>
      ) : (
        <div className="welcome">
          <h1>有什么想聊的？</h1>
        </div>
      )}
      <div className="write-area">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <textarea
            aria-label="对话消息"
            placeholder="写给 Wintermute…"
            rows={1}
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.nativeEvent.keyCode !== 229
              ) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <div className="composer-tools">
            <span>
              <CornerDownLeft size={13} />
              发送 <i /> Shift + Enter 换行
            </span>
            <button
              className="send-button"
              type="submit"
              aria-label="发送对话消息"
              disabled={!draft.trim() || sending}
            >
              <ArrowUp size={19} strokeWidth={2} />
            </button>
          </div>
        </form>
        {agent.materialIssue && (
          <p className="issue" role="status">
            材料待传 · {agent.materialIssue}
          </p>
        )}
        {status && (
          <p className="issue" role="status">
            {status}
          </p>
        )}
        {!hasMessages && (
          <div className="prompt-list">
            {prompts.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  setDraft(p.text)
                  input.current?.focus()
                }}
              >
                <p.icon size={15} />
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>('chat')
  const [collapsed, setCollapsed] = useState(initialSidebarCollapsed)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [connectionVersion, setConnectionVersion] = useState(0)
  const agent = useAgent()
  const [lastAlert,setNotice]=useState<(NoticeAlert & {version:number})|null>(null)
  const notice=lastAlert?.url===agent.url && lastAlert.terminal===agent.terminal && lastAlert.version===connectionVersion ? lastAlert : null
  const [focusNotice, setFocusNotice] = useState<NoticeAlert | null>(null)
  function openNotice(alert: NoticeAlert) {
    setFocusNotice(alert)
    setPage('schedule')
    setSettingsOpen(false)
    setNotice(null)
  }
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined
    const stop=window.wintermute?.onNotice?.(alert=>{
      if (alert.url!==agent.url || alert.terminal!==agent.terminal) return
      clearTimeout(timer)
      if (alert.open) openNotice(alert)
      else {
        setNotice({...alert,version:connectionVersion})
        timer=setTimeout(()=>setNotice(null),10000)
      }
    })
    return ()=>{clearTimeout(timer);stop?.()}
  },[agent.url,agent.terminal,connectionVersion])
  const showSettings = () => setSettingsOpen(true)
  const toggleLabel = collapsed ? '展开导航栏' : '收起导航栏'
  function toggleSidebar() {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(sidebarPreference, String(next))
    } catch {
      // The preference still applies to the current window.
    }
  }
  return (
    <div className="app-shell" data-collapsed={collapsed}>
      <aside className="sidebar">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleSidebar}
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={!collapsed}
          aria-controls="main-navigation"
        >
          {collapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
        </button>
        <nav id="main-navigation" className="nav-list" aria-label="主导航">
          {pages.map((p) => (
            <button
              key={p.id}
              className="nav-item"
              aria-label={p.label}
              aria-current={page === p.id ? 'page' : undefined}
              title={p.label}
              onClick={() => {
                if (page !== p.id) {
                  setPage(p.id)
                  setFocusNotice(null)
                }
              }}
            >
              <p.icon size={18} aria-hidden="true" />
              {!collapsed && <span>{p.label}</span>}
            </button>
          ))}
        </nav>
        <button
          className="nav-item settings-link"
          onClick={showSettings}
          title="终端设置"
          aria-label="终端设置"
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          {!collapsed && <span>设置</span>}
        </button>
      </aside>
      <main className="workspace">
        <div className="chat-host" hidden={page !== 'chat'}>
          <Chat
            agent={agent}
            settings={showSettings}
            visible={page === 'chat'}
          />
        </div>
        {page === 'schedule' && (
          <section
            aria-labelledby="schedule-heading"
            className="schedule-page"
            key={JSON.stringify([
              agent.url,
              agent.terminal,
              connectionVersion,
              agent.configured,
            ])}
          >
            <div className="schedule-inner">
              <header className="page-heading">
                <h1 id="schedule-heading">日程</h1>
              </header>
              <NotificationInbox
                connected={agent.configured}
                focusNotice={
                  focusNotice?.url === agent.url && focusNotice.terminal === agent.terminal
                    ? focusNotice
                    : null
                }
              />
              <section aria-label="日历">
                <ScheduleCalendar
                  connected={agent.configured}
                  settings={showSettings}
                />
              </section>
            </div>
          </section>
        )}
        {page === 'memory' && (
          <MemoryBrowser
            connectionRevision={agent.connectionRevision}
            connectionKey={JSON.stringify([agent.url, agent.terminal, agent.connectionRevision, connectionVersion])}
            connected={agent.configured}
            settings={showSettings}
          />
        )}
      </main>
      {notice && <aside className="notice-banner" aria-label="新通知" role="status">
        <button onClick={()=>openNotice(notice)}><strong>{notice.title}</strong><span>{notice.body}</span></button>
        <button aria-label="关闭提醒" onClick={()=>setNotice(null)}><X size={15}/></button>
      </aside>}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        {settingsOpen && (
          <AgentSettings
            state={agent}
            onConnected={() => setConnectionVersion((version) => version + 1)}
          />
        )}
      </Dialog>
    </div>
  )
}
