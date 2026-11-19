import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarDays,
  BookOpen,
  History,
  ListChecks,
  MessageCircle,
  NotebookPen,
  Plus,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { Dialog } from '@/components/ui/dialog'
import { DesktopLayout } from '@/components/desktop-layout'
import { AgentSettings } from '@/components/agent-settings'
import { ScheduleCalendar } from '@/components/schedule-calendar'
import type { NoticeAlert } from '@/lib/desktop'
import { MemoryBrowser } from '@/components/memory-browser'
import { QuestionCards } from '@/components/question-cards'
import { useAgent, type AgentState, type ChatMessage } from '@/lib/desktop'
import './App.css'

const pages = [
  { id: 'chat', label: '对话', icon: MessageCircle },
  { id: 'schedule', label: '日程', icon: CalendarDays },
  { id: 'memory', label: '记忆', icon: BookOpen },
] as const
type Page = (typeof pages)[number]['id']
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
const timestamp = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
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

function Message({
  message,
  at,
  retry,
}: {
  message: ChatMessage
  at: number
  retry: (id: string) => void
}) {
  const user = message.role === 'user'
  const notice = message.notificationReply
  const author = user ? '你' : notice ? 'Wintermute · 通知回复' : 'Wintermute'
  return (
    <article
      className={'message ' + (notice ? 'notification' : message.role)}
      aria-label={author}
    >
      <div
        className="message-bubble"
        title={Number.isFinite(at) ? timestamp.format(at) : undefined}
      >
        {notice && (
          <header>
            <Bell size={13} aria-hidden="true" />
            {author}
          </header>
        )}
        <p>{message.text}</p>
      </div>
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
  const promptSelected = useRef(false)
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
  }, [agent.messages.length, lastMessageId, visible, loadingEarlier, draft])
  function fillPrompt(text: string) {
    setDraft(text)
    input.current?.focus()
  }
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
    <section className="chat" aria-label="与 Wintermute 对话">
      <header className="chat-identity">
        <span className="chat-avatar" aria-hidden="true" />
        <span className="chat-name">Wintermute</span>
      </header>
      {hasMessages ? (
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
              const at = Date.parse(message.at ?? '')
              const previous = Date.parse(agent.messages[i - 1]?.at ?? '')
              const showTime =
                Number.isFinite(at) &&
                (!Number.isFinite(previous) ||
                  Math.abs(at - previous) >= 5 * 60_000 ||
                  new Date(at).toDateString() !==
                    new Date(previous).toDateString())
              return (
                <div key={message.id}>
                  {showTime && (
                    <time
                      className="chat-timestamp"
                      dateTime={message.at ?? undefined}
                    >
                      {timestamp.format(at)}
                    </time>
                  )}
                  <Message message={message} at={at} retry={retry} />
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="welcome">
          <h1>有什么想聊的？</h1>
          <div className="prompt-list">
            {prompts.map((p) => (
              <button key={p.label} onClick={() => fillPrompt(p.text)}>
                <p.icon size={15} aria-hidden="true" />
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="write-area">
        <QuestionCards questions={agent.questions} />
        {hasMessages && !atBottom && (
          <button
            type="button"
            className="jump-to-end"
            aria-label="最新消息"
            title="最新消息"
            onClick={() => {
              if (log.current) log.current.scrollTop = log.current.scrollHeight
            }}
          >
            <ArrowDown size={17} />
          </button>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          {hasMessages && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="prompt-trigger"
                  aria-label="快捷提问"
                  title="快捷提问"
                >
                  <Plus size={19} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="chat-prompt-menu"
                  side="top"
                  align="start"
                  sideOffset={10}
                  onCloseAutoFocus={(event) => {
                    if (promptSelected.current) {
                      event.preventDefault()
                      promptSelected.current = false
                      input.current?.focus()
                    }
                  }}
                >
                  {prompts.map((p) => (
                    <DropdownMenu.Item
                      key={p.label}
                      onSelect={() => {
                        promptSelected.current = true
                        setDraft(p.text)
                      }}
                    >
                      <p.icon size={15} aria-hidden="true" />
                      {p.label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
          <textarea
            aria-label="对话消息"
            aria-description="回车换行，Ctrl + Enter 或 ⌘ + Enter 发送"
            placeholder="发送消息"
            rows={1}
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                (e.ctrlKey || e.metaKey) &&
                !e.shiftKey &&
                !e.altKey &&
                !e.nativeEvent.isComposing &&
                e.nativeEvent.keyCode !== 229
              ) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button
            className="send-button"
            type="submit"
            aria-label="发送对话消息"
            aria-keyshortcuts="Control+Enter Meta+Enter"
            title="发送消息（Ctrl + Enter 或 ⌘ + Enter）"
            disabled={!draft.trim() || sending}
          >
            <ArrowUp size={19} strokeWidth={2} />
          </button>
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
      </div>
    </section>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>('chat')
  const [dialog, setDialog] = useState<'settings' | 'about' | null>(null)
  const [connectionVersion, setConnectionVersion] = useState(0)
  const agent = useAgent()
  const [lastAlert,setNotice]=useState<(NoticeAlert & {version:number})|null>(null)
  const notice=lastAlert?.url===agent.url && lastAlert.terminal===agent.terminal && lastAlert.version===connectionVersion ? lastAlert : null
  const [focusNotice, setFocusNotice] = useState<NoticeAlert | null>(null)
  function openNotice(alert: NoticeAlert) {
    setFocusNotice(alert)
    setPage('schedule')
    setDialog(null)
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
  const showSettings = () => setDialog('settings')
  return (
    <DesktopLayout aboutOpen={dialog === 'about'} onAboutChange={(open) => setDialog(open ? 'about' : null)}>
      <aside className="sidebar" id="app-sidebar">
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
              <span>{p.label}</span>
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
          <span>设置</span>
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
              <ScheduleCalendar
                connected={agent.configured}
                settings={showSettings}
                focusNotice={
                  focusNotice?.url === agent.url && focusNotice.terminal === agent.terminal
                    ? focusNotice
                    : null
                }
              />
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
      <Dialog open={dialog === 'settings'} onOpenChange={(open) => setDialog(open ? 'settings' : null)}>
        {dialog === 'settings' && (
          <AgentSettings
            state={agent}
            onConnected={() => setConnectionVersion((version) => version + 1)}
          />
        )}
      </Dialog>
    </DesktopLayout>
  )
}
