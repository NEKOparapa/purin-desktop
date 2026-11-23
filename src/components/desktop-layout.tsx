import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, Settings2 } from 'lucide-react'
import { DialogContent, DialogTrigger } from './ui/dialog'

export type Page = 'chat' | 'schedule'

function CalendarLeaf() {
  const [day, setDay] = useState(() => new Date().getDate())
  useEffect(() => {
    let timer: number
    function update() {
      const now = new Date()
      setDay(now.getDate())
      window.clearTimeout(timer)
      const tomorrow = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      )
      timer = window.setTimeout(update, tomorrow.getTime() - now.getTime())
    }
    update()
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return (
    <span className="calendar-leaf" aria-hidden="true">
      {day}
    </span>
  )
}

export function DesktopLayout({
  children,
  page,
  unread,
  onNavigate,
  settings,
}: {
  children: ReactNode
  page: Page
  unread: boolean
  onNavigate: (page: Page) => void
  settings: ReactNode
}) {
  const chat = page === 'chat'
  const label = chat
    ? unread
      ? '打开日程，有未读通知'
      : '打开日程'
    : '返回对话'
  return (
    <div className="app-shell">
      <header className="window-titlebar" aria-label="窗口标题栏" />
      <nav className="page-actions" aria-label="页面导航">
        <button
          type="button"
          className="page-switch"
          aria-label={label}
          title={label}
          onClick={() => onNavigate(chat ? 'schedule' : 'chat')}
        >
          {chat ? (
            <CalendarLeaf />
          ) : (
            <ChevronLeft size={20} aria-hidden="true" />
          )}
          {chat ? '日程' : '对话'}
          {chat && unread && (
            <span className="calendar-unread" aria-hidden="true" />
          )}
        </button>
        <DialogTrigger asChild>
          <button
            type="button"
            className="page-settings"
            aria-label="设置"
            title="设置"
          >
            <Settings2 size={18} aria-hidden="true" />
          </button>
        </DialogTrigger>
      </nav>
      {children}
      <DialogContent
        className="detail-dialog settings-dialog"
        aria-describedby={undefined}
      >
        {settings}
      </DialogContent>
    </div>
  )
}
