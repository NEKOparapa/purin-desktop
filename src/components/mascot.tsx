import { useCallback, useSyncExternalStore } from 'react'
import './mascot.css'

export function Mascot({ listening, thinking, replyReceivedAt, carried = false }: {
  listening: boolean
  thinking: boolean
  replyReceivedAt: number
  carried?: boolean
}) {
  const endsAt = replyReceivedAt + 3200
  const subscribe = useCallback((onExpire: () => void) => {
    const remaining = endsAt - Date.now()
    if (remaining <= 0) return () => {}
    const timeout = window.setTimeout(onExpire, remaining + 1)
    return () => window.clearTimeout(timeout)
  }, [endsAt])
  const speaking = useSyncExternalStore(subscribe, () => Date.now() < endsAt)
  const mood = listening ? 'listening' : thinking ? 'thinking' : speaking ? 'speaking' : 'idle'
  return <span className="mascot" data-mood={carried ? 'carried' : mood} aria-hidden="true" />
}
