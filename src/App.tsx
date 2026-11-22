import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  History,
  FileText,
  Paperclip,
  ListChecks,
  MessageCircle,
  Mic,
  NotebookPen,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { DesktopLayout } from '@/components/desktop-layout'
import { AgentSettings } from '@/components/agent-settings'
import { ScheduleCalendar } from '@/components/schedule-calendar'
import type { ChatFileRef, NoticeAlert } from '@/lib/desktop'
import { QuestionCards } from '@/components/question-cards'
import { VoiceInput } from '@/components/voice-input'
import { Files } from '@/components/history-files'
import { HistoryConnection } from '@/components/history-viewport'
import {
  maxAttachments,
  prepareAttachment,
  type DraftAttachment,
} from '@/lib/chat-media'
import { ChatJumpBar } from '@/components/chat-jump-bar'
import { useAgent, type AgentState, type ChatMessage } from '@/lib/desktop'
import './App.css'

const pages = [
  { id: 'chat', label: '对话', icon: MessageCircle },
  { id: 'schedule', label: '日程', icon: CalendarDays },
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
  return (
    <article
      className={'message ' + message.role}
      aria-label={user ? '你' : 'Wintermute'}
    >
      <div
        className="message-bubble"
        title={Number.isFinite(at) ? timestamp.format(at) : undefined}
      >
        {message.files && <Files files={message.files} />}
        {!message.files &&
          message.documents?.map((doc, i) => (
            <span className="queued-file" key={i}>
              <FileText size={15} />
              {doc.name}
            </span>
          ))}
        {message.images?.map((url, index) => (
          <img
            className="sent-image"
            key={index}
            src={url}
            alt={`聊天图片 ${index + 1}`}
          />
        ))}
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
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [readingFiles, setReadingFiles] = useState(false)
  const [uploading, setUploading] = useState('')
  const reading = useRef(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const [sending, setSending] = useState(false)
  const [issue, setIssue] = useState('')
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [activeJumpId, setActiveJumpId] = useState<string | null>(null)
  const follow = useRef(true)
  const log = useRef<HTMLDivElement>(null)
  const messageNodes = useRef(new Map<string, HTMLDivElement>())
  const input = useRef<HTMLTextAreaElement>(null)
  const lastMessageId = agent.messages.at(-1)?.id
  const hasMessages = agent.messages.length > 0 || agent.hasEarlier
  const userMessages = agent.messages.filter((m) => m.role === 'user')
  const jumpItems = userMessages.length > 0 ? userMessages : agent.messages
  const effectiveActiveJumpId = atBottom
    ? (jumpItems.at(-1)?.id ?? null)
    : (activeJumpId ?? jumpItems.at(-1)?.id ?? null)
  const olderAnchor = useRef<{ height: number; position: number } | null>(null)

  function syncActiveJump(el: HTMLDivElement, isBottom: boolean) {
    if (!jumpItems.length) return
    if (isBottom) {
      setActiveJumpId(jumpItems.at(-1)?.id ?? null)
      return
    }
    const scrollerTop = el.getBoundingClientRect().top
    const pivot = scrollerTop + Math.min(180, el.clientHeight * 0.32)
    let current = jumpItems[0].id
    for (const item of jumpItems) {
      const node = messageNodes.current.get(item.id)
      if (!node) continue
      if (node.getBoundingClientRect().top <= pivot) {
        current = item.id
      } else {
        break
      }
    }
    setActiveJumpId(current)
  }

  function jumpToMessage(id: string) {
    const el = log.current
    const node = messageNodes.current.get(id)
    if (!el || !node) return
    const isLast = id === jumpItems.at(-1)?.id
    follow.current = isLast
    setAtBottom(isLast)
    setActiveJumpId(id)
    const offset =
      node.getBoundingClientRect().top -
      el.getBoundingClientRect().top +
      el.scrollTop
    el.scrollTo({
      top: Math.max(0, offset - 96),
      behavior: 'smooth',
    })
  }
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
  async function addFiles(files: File[]) {
    if (!files.length || reading.current || sending) return
    if (files.length + attachments.length > maxAttachments) {
      setIssue('每条消息最多可添加 4 个附件。')
      return
    }
    reading.current = true
    setReadingFiles(true)
    setIssue('')
    try {
      const added: DraftAttachment[] = []
      for (const file of files) added.push(await prepareAttachment(file))
      setAttachments((current) => [...current, ...added])
    } catch (error) {
      setIssue(
        error instanceof Error ? error.message : '附件读取失败，请重新选择。',
      )
    } finally {
      reading.current = false
      setReadingFiles(false)
    }
  }
  const canSend =
    (draft.trim() || attachments.length) &&
    !voiceBusy &&
    !readingFiles &&
    !sending
  async function send() {
    if (!canSend) return
    if (!agent.configured || !window.wintermute) {
      settings()
      return
    }
    setSending(true)
    setIssue('')
    follow.current = true
    const text = draft
    try {
      const documents: ChatFileRef[] = []
      const images = attachments.filter((a) => a.kind === 'image')
      for (const item of attachments) {
        if (item.kind !== 'file') continue
        let ref = item.uploaded
        if (!ref) {
          if (agent.connectionRevision === undefined)
            throw new Error('设备连接已更改')
          setUploading(item.name)
          ref = await window.wintermute.uploadChatFile(
            item.name,
            await item.file.arrayBuffer(),
            agent.connectionRevision,
          )
          const uploaded = ref
          setAttachments((current) =>
            current.map((a) => (a.id === item.id ? { ...item, uploaded } : a)),
          )
        }
        documents.push(ref)
      }
      await window.wintermute.send(
        text,
        images.map((a) => a.url),
        documents,
        images.map((a) => a.name),
        agent.connectionRevision,
      )
      setDraft((current) => (current === text ? '' : current))
      setAttachments([])
    } catch (error) {
      setIssue(
        error instanceof Error
          ? error.message.replace(/^.*?Error: /, '')
          : '发送失败，请重试。',
      )
    } finally {
      setUploading('')
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
        <>
          <ChatJumpBar
            items={jumpItems}
            activeId={effectiveActiveJumpId}
            onJump={jumpToMessage}
          />
          <div
            className="message-scroller"
            ref={log}
            role="log"
            aria-label="消息记录"
            onScroll={() => {
              const el = log.current
              if (!el) return
              const isBottom =
                el.scrollHeight - el.scrollTop - el.clientHeight < 64
              follow.current = isBottom
              setAtBottom(isBottom)
              syncActiveJump(el, isBottom)
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
                  <div
                    key={message.id}
                    ref={(node) => {
                      if (node) messageNodes.current.set(message.id, node)
                      else messageNodes.current.delete(message.id)
                    }}
                  >
                    {showTime && (
                      <time
                        className="chat-timestamp"
                        dateTime={message.at ?? undefined}
                      >
                        {timestamp.format(at)}
                      </time>
                    )}
                    <HistoryConnection.Provider
                      value={agent.connectionRevision}
                    >
                      <Message message={message} at={at} retry={retry} />
                    </HistoryConnection.Provider>
                  </div>
                )
              })}
            </div>
          </div>
        </>
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
          className={'composer' + (dragging ? ' dragging' : '')}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
              setDragging(true)
            }
          }}
          onDragLeave={(event) => {
            if (!(
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            ))
              setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void addFiles(Array.from(event.dataTransfer.files))
          }}
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          {attachments.length > 0 && (
            <div className="draft-images" aria-label="待发送附件">
              {attachments.map((item) => (
                <div
                  className={
                    'draft-attachment ' +
                    (item.kind === 'image' ? 'with-thumbnail' : '')
                  }
                  key={item.id}
                >
                  {item.kind === 'image' ? (
                    <img src={item.url} alt={item.name} />
                  ) : (
                    <FileText size={21} aria-hidden="true" />
                  )}
                  <span title={item.name}>{item.name}</span>
                  <button
                    type="button"
                    disabled={sending}
                    aria-label={'移除 ' + item.name}
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter(
                          (attachment) => attachment.id !== item.id,
                        ),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            hidden
            type="file"
            ref={picker}
            multiple
            onChange={(event) => {
              void addFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <button
            className="composer-tool"
            type="button"
            aria-label="添加附件"
            title="添加文件或图片，也可拖入输入框"
            disabled={
              readingFiles || sending || attachments.length >= maxAttachments
            }
            onClick={() => picker.current?.click()}
          >
            <Paperclip size={19} />
          </button>
          <textarea
            aria-label="对话消息"
            aria-description="回车换行，Ctrl + Enter 或 ⌘ + Enter 发送"
            placeholder={dragging ? '松开以添加附件' : '发送消息，或拖入文件'}
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
          <span className="composer-spacer" />
          {visible &&
          agent.configured &&
          agent.connectionRevision !== undefined ? (
            <VoiceInput
              revision={agent.connectionRevision}
              onBusy={setVoiceBusy}
              onError={setIssue}
              onText={(text) => {
                setDraft(
                  (current) =>
                    current +
                    (current && !/\s$/.test(current) ? ' ' : '') +
                    text,
                )
                input.current?.focus()
              }}
            />
          ) : (
            <button
              type="button"
              className="composer-tool"
              title="连接设备后使用语音输入"
              aria-label="语音输入"
              onClick={settings}
            >
              <Mic size={19} />
            </button>
          )}
          <button
            className="send-button"
            type="submit"
            aria-label="发送对话消息"
            aria-keyshortcuts="Control+Enter Meta+Enter"
            title="发送消息（Ctrl + Enter 或 ⌘ + Enter）"
            disabled={!canSend}
          >
            <ArrowUp size={19} strokeWidth={2} />
          </button>
        </form>
        {uploading && (
          <p className="upload-status" role="status">
            正在上传并解析 {uploading}…
          </p>
        )}
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
  const notice=lastAlert?.url===agent.url && lastAlert.deviceId===agent.deviceId && lastAlert.version===connectionVersion ? lastAlert : null
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
      if (alert.url!==agent.url || alert.deviceId!==agent.deviceId) return
      clearTimeout(timer)
      if (alert.open) openNotice(alert)
      else {
        setNotice({...alert,version:connectionVersion})
        timer=setTimeout(()=>setNotice(null),10000)
      }
    })
    return ()=>{clearTimeout(timer);stop?.()}
  },[agent.url,agent.deviceId,connectionVersion])
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
          title="设备设置"
          aria-label="设备设置"
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span>设置</span>
        </button>
      </aside>
      <main className="workspace">
        <div className="chat-host" hidden={page !== 'chat'}>
          <Chat
            key={JSON.stringify([agent.url, agent.deviceId, agent.connectionRevision])}
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
              agent.deviceId,
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
                  focusNotice?.url === agent.url && focusNotice.deviceId === agent.deviceId
                    ? focusNotice
                    : null
                }
              />
            </div>
          </section>
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
