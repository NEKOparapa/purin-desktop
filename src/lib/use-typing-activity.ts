import { useEffect, useRef, useState } from 'react'

export function useTypingActivity() {
  const [typing, setTyping] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  function stop() {
    window.clearTimeout(timer.current)
    setTyping(false)
  }
  function noteInput() {
    window.clearTimeout(timer.current)
    setTyping(true)
    timer.current = window.setTimeout(stop, 1500)
  }
  return { typing, noteInput, stop }
}
