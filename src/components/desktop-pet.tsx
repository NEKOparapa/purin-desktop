import { translateKnown, applyLanguage, t } from '@/lib/i18n'
import { type DragEvent, type Ref, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, X } from 'lucide-react'
import { Mascot } from '@/components/mascot'
import { VoiceInput } from '@/components/voice-input'
import { DraftAttachments } from '@/components/draft-attachments'
import { knownChatFileType } from '@/lib/chat-media'
import { useChatAttachments } from '@/lib/use-chat-attachments'
import { useTypingActivity } from '@/lib/use-typing-activity'
import type { PetBridge, PetSnapshot } from '@/lib/desktop'
import { layoutPet } from '@/lib/pet-layout'
import './desktop-pet.css'

const singleClickDelayMs = 500
const editorIdleMs = 30_000
const quietFocus = { preventScroll: true, focusVisible: false }

function useAutoHide(delay: number | null, dismiss: () => void) {
  const timer = useRef<number | undefined>(undefined)
  const restart = useCallback(() => {
    window.clearTimeout(timer.current)
    if (delay !== null) timer.current = window.setTimeout(dismiss, delay)
  }, [delay, dismiss])
  useEffect(() => {
    restart()
    return () => window.clearTimeout(timer.current)
  }, [restart])
  return restart
}

function PetBubble({ ref, message, thinking, delay, dismiss }: {
  ref: Ref<HTMLDivElement>
  message: string
  thinking?: boolean
  delay: number | null
  dismiss: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [keyboardReading, setKeyboardReading] = useState(false)
  useAutoHide(hovered || keyboardReading ? null : delay, dismiss)
  return (
    <div
      ref={ref}
      className="pet-bubble"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={() => setKeyboardReading(false)}
      onFocus={event => setKeyboardReading(event.target.matches(':focus-visible'))}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardReading(false)
      }}
    >
      <p role="status" tabIndex={0} aria-label={thinking ? message : undefined}>
        {thinking ? (
          <span className="thinking-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : (
          message
        )}
      </p>
      <button aria-label={t('收起气泡')} title={t('收起气泡')} onClick={dismiss}>
        <X size={14} />
      </button>
    </div>
  )
}

export function DesktopPet({ api }: { api: PetBridge }) {
  const [state, setState] = useState<PetSnapshot | null>(null)
  useEffect(() => {
    let live = true,
      received = false
    function update(next: PetSnapshot) {
      document.documentElement.dataset.appearance = next.appearance
      applyLanguage(next.language)
      document.title = t('Purin 桌宠')
      setState(next)
    }
    const stop = api.subscribe((next) => {
      received = true
      update(next)
    }, position => {
      setState(current => current?.session === position.session ? { ...current, ...position } : current)
    })
    void api
      .state()
      .then((next) => {
        if (live && !received) update(next)
      })
      .catch(() => {
        /* A closed session will receive a snapshot on re-entry. */
      })
    return () => {
      live = false
      stop()
    }
  }, [api])
  if (!state) return null
  return <PetChat key={state.connectionRevision} api={api} state={state} />
}

function PetChat({ api, state }: { api: PetBridge; state: PetSnapshot }) {
  const shell = useRef<HTMLElement>(null)
  const avatar = useRef<HTMLButtonElement>(null)
  const composer = useRef<HTMLFormElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const pendingClick = useRef<number | undefined>(undefined)
  const press = useRef<{
    id: number; x: number; y: number; dx: number; dy: number; moved: boolean
  } | null>(null)
  const skipClick = useRef(false)
  const secondClick = useRef(false)
  const [carriedSession, setCarriedSession] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const { attachments, readingFiles, uploading, addFiles, prepareMessage, removeAttachment, clearAttachments } = useChatAttachments()
  const activity = useTypingActivity()
  const [editorSession, setEditorSession] = useState<number | null>(null)
  const [error, setError] = useState<{ session: number; text: string } | null>(
    null,
  )
  const [sending, setSending] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [composing, setComposing] = useState(false)
  const [dismissed, setDismissed] = useState('')
  const editing = editorSession === state.session
  const issue = (error?.session === state.session && error.text) || state.issue
  const thinkingBubble = !issue && !state.reply && state.waiting
  const message =
    translateKnown(issue || '') || state.reply?.text || (state.waiting ? t('正在思考…') : '')
  const bubbleId = JSON.stringify([
    state.session,
    issue || state.reply?.id || 'waiting',
  ])
  const showBubble = !!message && dismissed !== bubbleId
  const dismissBubble = useCallback(() => {
    if (document.hasFocus() && bubble.current?.contains(document.activeElement))
      (input.current ?? avatar.current)?.focus(quietFocus)
    setDismissed(bubbleId)
  }, [bubbleId])
  const readingMs = issue || state.reply
    ? Math.min(30_000, Math.max(12_000, message.length * 180))
    : null
  const closeEditor = useCallback(() => {
    const focused = document.activeElement
    if (document.hasFocus() && (composer.current?.contains(focused) || focused === document.body))
      avatar.current?.focus(quietFocus)
    setEditorSession(null)
    setComposing(false)
  }, [])
  const restartEditorTimer = useAutoHide(
    editing && !composing && !sending && !readingFiles && !voiceBusy ? editorIdleMs : null, closeEditor,
  )

  function cancelPendingClick() {
    window.clearTimeout(pendingClick.current)
    pendingClick.current = undefined
  }
  useEffect(() => () => {
    cancelPendingClick()
    if (press.current?.moved) void api.drop(state.session).catch(() => {})
    press.current = null
  }, [api, state.session])

  function moveTo(screenX: number, screenY: number) {
    const drag = press.current
    if (drag) void api.move(Math.round(screenX - drag.dx), Math.round(screenY - drag.dy), state.session).catch(() => {})
  }

  function endPress(pointerId: number) {
    const drag = press.current
    if (!drag || drag.id !== pointerId) return
    press.current = null
    if (drag.moved) {
      setCarriedSession(null)
      skipClick.current = true
      void api.drop(state.session).catch(() => {
        setError({ session: state.session, text: t('桌宠位置暂时无法保存。') })
      })
    }
  }

  useLayoutEffect(() => {
    const el = shell.current
    if (!el) return
    el.style.setProperty('--work-width', state.workArea.width + 'px')
    el.style.setProperty('--work-height', state.workArea.height + 'px')
    const resize = () => {
      // Measure the natural bubble before fitting it into the room above or below.
      el.style.removeProperty('--bubble-max-height')
      const layout = layoutPet(
        { width: state.workArea.width, height: state.workArea.height },
        { x: state.anchor.x, y: state.anchor.y },
        state.preferredSide,
        composer.current?.getBoundingClientRect(),
        bubble.current?.getBoundingClientRect(),
      )
      // Layout uses display coordinates. The native window encloses just these parts.
      const { x, y, width, height } = layout.region
      el.dataset.bubbleSide = layout.side
      el.style.setProperty('--pet-x', state.anchor.x - x + 'px')
      el.style.setProperty('--pet-y', state.anchor.y - y + 'px')
      el.style.setProperty('--composer-left', layout.composerLeft - x + 'px')
      el.style.setProperty('--composer-top', layout.composerTop - y + 'px')
      el.style.setProperty('--bubble-x', layout.bubbleX - x + 'px')
      el.style.setProperty('--bubble-y', layout.bubbleY - y + 'px')
      el.style.setProperty('--bubble-max-height', layout.bubbleMaxHeight + 'px')
      if (layout.outline) {
        el.style.setProperty('--bubble-outline', `path("${layout.outline.path}") border-box`)
      }
      void api
        .setRegion({ x: state.workArea.x + x, y: state.workArea.y + y, width, height }, layout.shape, state.session)
        .catch(() => {
          /* Window has closed. */
        })
    }
    resize()
    const observer = new ResizeObserver(resize)
    if (composer.current) observer.observe(composer.current)
    if (bubble.current) observer.observe(bubble.current)
    return () => observer.disconnect()
  }, [
    api,
    state.session,
    state.workArea.x,
    state.workArea.y,
    state.workArea.width,
    state.workArea.height,
    state.anchor.x,
    state.anchor.y,
    state.preferredSide,
    editing,
    showBubble,
    message,
  ])
  useLayoutEffect(() => {
    if (editing) input.current?.focus({ preventScroll: true })
  }, [editing])

  function openEditor() {
    setEditorSession(state.session)
    restartEditorTimer()
    input.current?.focus({ preventScroll: true })
  }
  function dragOver(event: DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = sending || readingFiles ? 'none' : 'copy'
    if (sending || readingFiles) return
    if (editing) restartEditorTimer()
    else if (Array.from(event.dataTransfer.items).some(item => item.kind === 'file' && knownChatFileType(item.type)))
      openEditor()
  }
  async function attachDrop(event: DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    if (sending || readingFiles) return
    cancelPendingClick()
    setError(null)
    setDismissed('')
    try {
      if (await addFiles(event.dataTransfer)) openEditor()
    } catch (error) {
      setError({ session: state.session, text: error instanceof Error ? translateKnown(error.message) : t('附件读取失败，请重试。') })
    }
  }
  const canSend = !!(draft.trim() || attachments.length) && state.configured && !sending && !voiceBusy && !readingFiles
  async function send() {
    if (!canSend) return
    const text = draft
    setSending(true)
    activity.stop()
    setDismissed('')
    setError(null)
    try {
      const media = await prepareMessage(api.uploadChatFile, state.connectionRevision)
      await api.send(text, state.connectionRevision, media)
      setDraft((current) => (current === text ? '' : current))
      clearAttachments()
      closeEditor()
    } catch (error) {
      setError({
        session: state.session,
        text: error instanceof Error ? translateKnown(error.message.replace(/^.*?Error: /, '')) : t('消息未能发送，请检查连接后再试。'),
      })
    } finally {
      setSending(false)
    }
  }
  return (
    <main
      ref={shell}
      className="pet-shell"
      aria-label={t('桌宠')}
      onKeyDown={(event) => {
        if (
          event.key !== 'Escape' ||
          event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229
        )
          return
        cancelPendingClick()
        if (editing) closeEditor()
        else if (showBubble) {
          dismissBubble()
          avatar.current?.focus(quietFocus)
        } else void api.restore()
      }}
    >
      <div className="pet-head" onDragEnter={dragOver} onDragOver={dragOver} onDrop={attachDrop}>
        <button
          ref={avatar}
          className="pet-avatar"
          aria-label={t('和桌宠聊天')}
          aria-description={t('拖入文件添加附件，拖动调整位置，单击打开输入框，双击返回主窗口')}
          aria-expanded={editing}
          title={t('拖入文件添加附件，拖动调整位置，单击聊天，双击返回主窗口')}
          onBlur={cancelPendingClick}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return
            secondClick.current = pendingClick.current !== undefined
            cancelPendingClick()
            skipClick.current = false
            const rect = event.currentTarget.getBoundingClientRect()
            press.current = {
              id: event.pointerId, x: event.screenX, y: event.screenY,
              dx: event.clientX - rect.left - rect.width / 2,
              dy: event.clientY - rect.top - rect.height / 2, moved: false,
            }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const drag = press.current
            if (!drag || drag.id !== event.pointerId) return
            if (event.buttons === 0) return endPress(event.pointerId)
            if (!drag.moved) {
              if (Math.hypot(event.screenX - drag.x, event.screenY - drag.y) < 5) return
              drag.moved = true
              setCarriedSession(state.session)
            }
            moveTo(event.screenX, event.screenY)
          }}
          onPointerUp={event => {
            if (press.current?.id === event.pointerId && press.current.moved) moveTo(event.screenX, event.screenY)
            endPress(event.pointerId)
          }}
          onLostPointerCapture={event => endPress(event.pointerId)}
          onPointerCancel={event => endPress(event.pointerId)}
          onClick={(event) => {
            if (event.detail === 0) openEditor()
            else if (!skipClick.current) {
              if (secondClick.current) void api.restore()
              else pendingClick.current = window.setTimeout(() => {
                pendingClick.current = undefined
                openEditor()
              }, singleClickDelayMs)
            }
          }}
        >
          <Mascot
            carried={carriedSession === state.session}
            listening={editing && (activity.typing || voiceBusy)}
            thinking={sending || state.awaitingReply}
            replyReceivedAt={state.replyReceivedAt}
          />
        </button>
      </div>
      {showBubble && (
        <PetBubble
          ref={bubble}
          message={message}
          thinking={thinkingBubble}
          delay={readingMs}
          dismiss={dismissBubble}
        />
      )}
      {editing && (
        <form
          ref={composer}
          className="pet-composer"
          onDragEnter={dragOver}
          onDragOver={dragOver}
          onDrop={attachDrop}
          onInput={restartEditorTimer}
          onKeyDown={restartEditorTimer}
          onFocus={restartEditorTimer}
          onPointerDown={restartEditorTimer}
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <DraftAttachments items={attachments} sending={sending} remove={removeAttachment} />
          <textarea
            ref={input}
            aria-label={t('桌宠消息')}
            rows={1}
            placeholder={t('想说点什么？')}
            value={draft}
            disabled={sending}
            onChange={(event) => {
              setDraft(event.target.value)
              activity.noteInput()
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionUpdate={activity.noteInput}
            onCompositionEnd={() => setComposing(false)}
            onBlur={() => {
              activity.stop()
              setComposing(false)
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <button
            type="button"
            aria-label={t('收起输入框')}
            title={t('收起输入框')}
            onClick={closeEditor}
          >
            <X size={15} />
          </button>
          <VoiceInput
            revision={state.connectionRevision}
            transcribe={api.transcribe}
            disabledReason={!state.configured ? t('连接设备后使用语音输入') : sending ? t('正在发送消息') : undefined}
            onBusy={setVoiceBusy}
            onError={(text) => {
              setDismissed('')
              setError(text ? { session: state.session, text } : null)
            }}
            onText={(text) => {
              setDraft(current => current + (current && !/\s$/.test(current) ? ' ' : '') + text)
              input.current?.focus(quietFocus)
            }}
          />
          {state.configured ? (
            <button
              type="submit"
              className="pet-send"
              disabled={!canSend}
              aria-label={t('发送桌宠消息')}
              title={t('发送')}
            >
              <ArrowUp size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="pet-connect"
              onClick={() => void api.restore(true)}
            >
              {t('去连接')}
            </button>
          )}
          {(readingFiles || uploading) && (
            <span className="pet-file-status" role="status">{uploading ? t('正在上传并解析 {0}…', uploading) : t('正在读取附件…')}</span>
          )}
        </form>
      )}
    </main>
  )
}
