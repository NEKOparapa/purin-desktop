import type { ReactNode } from 'react'
import { CalendarDays, Menu, MessageCircle, Settings } from 'lucide-react'
import {
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'

const pages = [
  { id: 'chat', label: '对话', icon: MessageCircle },
  { id: 'schedule', label: '日程', icon: CalendarDays },
] as const
export type Page = (typeof pages)[number]['id']
export type Panel = 'navigation' | 'settings'

export function DesktopLayout({
  children,
  page,
  panel,
  onNavigate,
  onPanelChange,
  settings,
}: {
  children: ReactNode
  page: Page
  panel: Panel
  onNavigate: (page: Page) => void
  onPanelChange: (panel: Panel) => void
  settings: ReactNode
}) {
  return (
    <div className="app-shell">
      <header className="window-titlebar" aria-label="窗口标题栏">
        <div className="titlebar-tools">
          <DialogTrigger asChild>
            <button
              type="button"
              className="titlebar-button"
              aria-label="打开导航"
              title="打开导航"
            >
              <Menu size={19} aria-hidden="true" />
            </button>
          </DialogTrigger>
        </div>
      </header>
      {children}
      <DialogContent
        className={
          panel === 'navigation'
            ? 'nav-drawer'
            : 'detail-dialog settings-dialog'
        }
        overlayClassName={
          panel === 'navigation' ? 'drawer-backdrop' : undefined
        }
        aria-describedby={undefined}
        showCloseButton={panel === 'settings'}
      >
        {panel === 'navigation' && (
          <>
            <DialogTitle className="sr-only">主导航</DialogTitle>
            <nav className="nav-list" aria-label="主导航">
              {pages.map(({ id, label, icon: Icon }) => (
                <DialogClose asChild key={id}>
                  <button
                    type="button"
                    className="nav-item"
                    aria-current={page === id ? 'page' : undefined}
                    onClick={() => onNavigate(id)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    {label}
                  </button>
                </DialogClose>
              ))}
            </nav>
            <div className="drawer-footer">
              <button
                type="button"
                className="nav-item"
                onClick={() => onPanelChange('settings')}
              >
                <Settings size={17} aria-hidden="true" />
                设置
              </button>
            </div>
          </>
        )}
        {panel === 'settings' && settings}
      </DialogContent>
    </div>
  )
}
