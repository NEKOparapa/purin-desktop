import { type Ref, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, X } from 'lucide-react'
import { Mascot } from '@/components/mascot'
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

function PetBubble({ ref, message, delay, dismiss }: {
  ref: Ref<HTMLDivElement>
  message: string
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
      <p role="status" tabIndex={0}>{message}</p>
      <button aria-label="收起气泡" title="收起气泡" onClick={dismiss}>
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
  const activity = useTypingActivity()
  const [editorSession, setEditorSession] = useState<number | null>(null)
  const [error, setError] = useState<{ session: number; text: string } | null>(
    null,
  )
  const [sending, setSending] = useState(false)
  const [composing, setComposing] = useState(false)
  const [dismissed, setDismissed] = useState('')
  const editing = editorSession === state.session
  const issue = (error?.session === state.session && error.text) || state.issue
  const message =
    issue || state.reply?.text || (state.waiting ? '等我一下…' : '')
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
  const restartEditorTimer = useAutoHide(editing && !composing && !sending ? editorIdleMs : null, closeEditor)

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
        setError({ session: state.session, text: '桌宠位置暂时无法保存。' })
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
  async function send() {
    if (!draft.trim() || !state.configured || sending) return
    const text = draft
    setSending(true)
    activity.stop()
    setDismissed('')
    setError(null)
    try {
      await api.send(text, state.connectionRevision)
      setDraft((current) => (current === text ? '' : current))
      closeEditor()
    } catch {
      setError({
        session: state.session,
        text: '消息未能发送，请检查连接后再试。',
      })
    } finally {
      setSending(false)
    }
  }
  return (
    <main
      ref={shell}
      className="pet-shell"
      aria-label="桌宠"
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
      <div className="pet-head">
        <button
          ref={avatar}
          className="pet-avatar"
          aria-label="和桌宠聊天"
          aria-description="拖动调整位置，单击打开输入框，双击返回主窗口"
          aria-expanded={editing}
          title="拖动调整位置，单击聊天，双击返回主窗口"
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
            listening={editing && activity.typing}
            thinking={sending || state.awaitingReply}
            replyReceivedAt={state.replyReceivedAt}
          />
        </button>
      </div>
      {showBubble && (
        <PetBubble
          ref={bubble}
          message={message}
          delay={readingMs}
          dismiss={dismissBubble}
        />
      )}
      {editing && (
        <form
          ref={composer}
          className="pet-composer"
          onInput={restartEditorTimer}
          onKeyDown={restartEditorTimer}
          onFocus={restartEditorTimer}
          onPointerDown={restartEditorTimer}
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <textarea
            ref={input}
            aria-label="桌宠消息"
            rows={1}
            placeholder="想说点什么？"
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
            aria-label="收起输入框"
            title="收起输入框"
            onClick={closeEditor}
          >
            <X size={15} />
          </button>
          {state.configured ? (
            <button
              type="submit"
              className="pet-send"
              disabled={!draft.trim() || sending}
              aria-label="发送桌宠消息"
              title="发送"
            >
              <ArrowUp size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="pet-connect"
              onClick={() => void api.restore(true)}
            >
              去连接
            </button>
          )}
        </form>
      )}
    </main>
  )
}
