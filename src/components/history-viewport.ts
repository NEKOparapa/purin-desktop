import { createContext, useEffect, useRef, useState } from 'react'

export const HistoryConnection = createContext<number | undefined>(undefined)

export function useNearViewport<T extends HTMLElement>(once = false) {
  const element = useRef<T>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (!element.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        setNear(entry.isIntersecting)
        if (once && entry.isIntersecting) observer.disconnect()
      },
      { rootMargin: '160px' },
    )
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [once])
  return { element, near }
}
