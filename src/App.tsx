import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CookingPot,
  FileText,
  Paperclip,
  Mic,
  Sun,
  X,
} from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { DesktopLayout, type Page } from '@/components/desktop-layout'
import { Mascot } from '@/components/mascot'
import { useTypingActivity } from '@/lib/use-typing-activity'
import { AgentSettings } from '@/components/agent-settings'
import { ScheduleCalendar } from '@/components/schedule-calendar'
import type { NoticeAlert } from '@/lib/desktop'
import { QuestionCards } from '@/components/question-cards'
import { VoiceInput } from '@/components/voice-input'
import { Files } from '@/components/history-files'
import { HistoryConnection } from '@/components/history-viewport'
import { DraftAttachments } from '@/components/draft-attachments'
import { maxAttachments } from '@/lib/chat-media'
import { useChatAttachments } from '@/lib/use-chat-attachments'
import { useAgent, type AgentState, type ChatMessage } from '@/lib/desktop'
import './App.css'

const assistantName = 'Wintermute'
const prompts = [
  { label: '聊聊今天', text: '我想跟你聊聊今天发生的事。', icon: Sun },
  { label: '想想晚饭', text: '今晚吃点什么好呢？', icon: CookingPot },
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
      aria-label={user ? '你' : assistantName}
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
  const activity = useTypingActivity()
  const { attachments, readingFiles, uploading, addFiles, prepareMessage, removeAttachment, clearAttachments } = useChatAttachments()
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const [sending, setSending] = useState(false)
  const [issue, setIssue] = useState('')
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const follow = useRef(true)
  const log = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const compactLine = useRef<HTMLSpanElement>(null)
  const [wraps, setWraps] = useState(false)
  const hasLineBreak = draft.includes('\n')
  const expanded = hasLineBreak || wraps
  const lastMessageId = agent.messages.at(-1)?.id
  const hasMessages = agent.messages.length > 0 || agent.hasEarlier
  const olderAnchor = useRef<{ height: number; position: number } | null>(null)

  useLayoutEffect(() => {
    const line = compactLine.current!
    // The probe keeps the width between the buttons even when the editor spans the form.
    const observer = new ResizeObserver(([entry]) => {
      setWraps(
        entry.contentRect.height > parseFloat(getComputedStyle(line).lineHeight),
      )
    })
    observer.observe(line)
    return () => observer.disconnect()
  }, [])

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
    if (visible && !loadingEarlier && olderAnchor.current && log.current) {
      const anchor = olderAnchor.current
      log.current.scrollTop =
        anchor.position + log.current.scrollHeight - anchor.height
      olderAnchor.current = null
    } else if (visible && follow.current && log.current)
      log.current.scrollTop = log.current.scrollHeight
  }, [agent.messages.length, lastMessageId, visible, loadingEarlier, draft, expanded])
  function fillPrompt(text: string) {
    setDraft(text)
    activity.noteInput()
    input.current?.focus()
  }
  async function attach(files: File[]) {
    if (!files.length || readingFiles || sending) return
    setIssue('')
    try {
      await addFiles(files)
    } catch (error) {
      setIssue(
        error instanceof Error ? error.message : '附件读取失败，请重新选择。',
      )
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
    activity.stop()
    setIssue('')
    follow.current = true
    const text = draft
    try {
      const { images, documents, imageNames } = await prepareMessage(window.wintermute.uploadChatFile, agent.connectionRevision)
      await window.wintermute.send(
        text,
        images,
        documents,
        imageNames,
        agent.connectionRevision,
      )
      setDraft((current) => (current === text ? '' : current))
      clearAttachments()
    } catch (error) {
      setIssue(
        error instanceof Error
          ? error.message.replace(/^.*?Error: /, '')
          : '发送失败，请重试。',
      )
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
      className="chat"
      data-empty={!hasMessages}
      aria-label={`与 ${assistantName} 对话`}
    >
      <button
        className="assistant-avatar"
        type="button"
        aria-label="进入桌宠模式"
        title={window.wintermute ? '收起对话，进入桌宠模式' : '在桌面应用中使用桌宠'}
        disabled={!window.wintermute}
        onClick={() => {
          void window.wintermute?.enterPetMode().catch(() =>
            setIssue('桌宠暂时无法打开，请再试一次。'),
          )
        }}
      >
        <Mascot
          listening={activity.typing || voiceBusy}
          thinking={sending || agent.awaitingReply}
          replyReceivedAt={agent.replyReceivedAt}
        />
      </button>
      <span className="assistant-name">{assistantName}</span>
      {hasMessages ? (
        <div
          className="message-scroller"
          ref={log}
          role="log"
          aria-label="消息记录"
          onScroll={(event) => {
            const el = event.currentTarget
            const isBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64
            follow.current = isBottom
            setAtBottom(isBottom)
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
                  <HistoryConnection.Provider value={agent.connectionRevision}>
                    <Message message={message} at={at} retry={retry} />
                  </HistoryConnection.Provider>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <h1 className="welcome">今天过得怎么样？</h1>
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
          data-expanded={expanded}
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
            void attach(Array.from(event.dataTransfer.files))
          }}
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <DraftAttachments items={attachments} sending={sending} remove={removeAttachment} />
          <input
            hidden
            type="file"
            ref={picker}
            multiple
            onChange={(event) => {
              void attach(Array.from(event.target.files ?? []))
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
          <span className="composer-line" ref={compactLine} aria-hidden="true">
            {hasLineBreak ? '' : draft}
          </span>
          <textarea
            aria-label="对话消息"
            aria-description="回车换行，Ctrl + Enter 或 ⌘ + Enter 发送"
            placeholder={dragging ? '松开以添加附件' : '想说点什么？'}
            rows={1}
            ref={input}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              activity.noteInput()
            }}
            onCompositionUpdate={activity.noteInput}
            onBlur={activity.stop}
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
          <div className="composer-actions">
            {visible &&
            window.wintermute &&
            agent.configured &&
            agent.connectionRevision !== undefined ? (
              <VoiceInput
                revision={agent.connectionRevision}
                transcribe={window.wintermute.transcribe}
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
          </div>
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
      {!hasMessages && (
        <div className="prompt-list" aria-label="聊天话题" role="group">
          {prompts.map(({ label, text, icon: Icon }) => (
            <button type="button" key={label} onClick={() => fillPrompt(text)}>
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>('chat')
  const [panelOpen, setPanelOpen] = useState(false)
  useEffect(() => window.wintermute?.onPetSettings(() => {
    setPanelOpen(true)
  }), [])
  const [connectionVersion, setConnectionVersion] = useState(0)
  const agent = useAgent()
  const [lastAlert,setNotice]=useState<(NoticeAlert & {version:number})|null>(null)
  const notice=lastAlert?.url===agent.url && lastAlert.deviceId===agent.deviceId && lastAlert.version===connectionVersion ? lastAlert : null
  const [focusNotice, setFocusNotice] = useState<NoticeAlert | null>(null)
  function openNotice(alert: NoticeAlert) {
    setFocusNotice(alert)
    setPage('schedule')
    setPanelOpen(false)
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
  const showSettings = () => setPanelOpen(true)
  return (
    <Dialog open={panelOpen} onOpenChange={setPanelOpen}>
      <DesktopLayout
        page={page}
        unread={agent.hasUnreadNotifications}
        onNavigate={(next) => {
          if (page !== next) {
            setFocusNotice(null)
            setPage(next)
          }
        }}
        settings={
          <AgentSettings
            state={agent}
            onConnected={() => setConnectionVersion((version) => version + 1)}
          />
        }
      >
        <main className="workspace">
          <div className="chat-host" hidden={page !== 'chat'}>
            <Chat
              key={JSON.stringify([
                agent.url,
                agent.deviceId,
                agent.connectionRevision,
              ])}
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
                <header className="sr-only">
                  <h1 id="schedule-heading">日程</h1>
                </header>
                <ScheduleCalendar
                  connected={agent.configured}
                  settings={showSettings}
                  focusNotice={
                    focusNotice?.url === agent.url &&
                    focusNotice.deviceId === agent.deviceId
                      ? focusNotice
                      : null
                  }
                />
              </div>
            </section>
          )}
        </main>
        {notice && (
          <aside className="notice-banner" aria-label="新通知" role="status">
            <button onClick={() => openNotice(notice)}>
              <strong>{notice.title}</strong>
              <span>{notice.body}</span>
            </button>
            <button aria-label="关闭提醒" onClick={() => setNotice(null)}>
              <X size={15} />
            </button>
          </aside>
        )}
      </DesktopLayout>
    </Dialog>
  )
}
