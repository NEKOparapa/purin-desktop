import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { CircleHelp, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { version } from '../../package.json'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'

const collapsedKey = 'wintermute.sidebarCollapsed'
const widthKey = 'wintermute.sidebarWidth'
const railWidth = 60

function preference(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* Use the in-memory layout. */
  }
}

export function DesktopLayout({
  children,
  aboutOpen,
  onAboutChange,
}: {
  children: ReactNode
  aboutOpen: boolean
  onAboutChange: (open: boolean) => void
}) {
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const [collapsed, setCollapsed] = useState(() => {
    const saved = preference(collapsedKey)
    return saved === null ? window.innerWidth <= 750 : saved === 'true'
  })
  const [preferredWidth, setPreferredWidth] = useState(() => {
    const saved = Number(preference(widthKey))
    return Number.isFinite(saved) && saved > railWidth ? saved : null
  })
  const [preview, setPreview] = useState<number | null>(null)
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(
    null,
  )
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const maximum = Math.min(360, Math.floor(viewport * 0.45))
  const minimum = Math.min(152, maximum)
  const defaultWidth = Math.max(172, Math.min(214, Math.round(viewport * 0.16)))
  const expandedWidth = Math.max(
    minimum,
    Math.min(maximum, preferredWidth ?? defaultWidth),
  )
  const width = preview ?? (collapsed ? railWidth : expandedWidth)
  const compact = width === railWidth
  const toggleLabel = compact ? '展开导航栏' : '收起导航栏'

  function changeCollapsed(next: boolean) {
    setCollapsed(next)
    savePreference(collapsedKey, String(next))
  }
  function commitWidth(next: number) {
    changeCollapsed(next === railWidth)
    if (next !== railWidth) {
      setPreferredWidth(next)
      savePreference(widthKey, String(next))
    }
  }
  function pointerWidth(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (start?.pointerId !== event.pointerId) return null
    const next = Math.round(start.width + event.clientX - start.x)
    return next < (minimum + railWidth) / 2
      ? railWidth
      : Math.max(minimum, Math.min(next, maximum))
  }
  function endDrag() {
    drag.current = null
    setPreview(null)
  }
  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    let next: number
    switch (event.key) {
      case 'ArrowLeft':
        next = width <= minimum ? railWidth : Math.max(minimum, width - 16)
        break
      case 'ArrowRight':
        next = Math.min(maximum, Math.max(minimum, width + 16))
        break
      case 'Home':
        next = railWidth
        break
      case 'End':
        next = maximum
        break
      default:
        return
    }
    event.preventDefault()
    commitWidth(next)
  }
  return (
    <div
      className="app-shell"
      data-collapsed={compact}
      data-resizing={preview !== null}
      style={{ '--sidebar-width': width + 'px' } as CSSProperties}
    >
      <header className="window-titlebar" aria-label="窗口标题栏">
        <div className="titlebar-tools">
          <button
            type="button"
            className="titlebar-button"
            aria-label={toggleLabel}
            title={toggleLabel}
            aria-expanded={!compact}
            aria-controls="main-navigation"
            onClick={() => changeCollapsed(!compact)}
          >
            {compact ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>
          <span className="app-name">Wintermute</span>
          <Dialog open={aboutOpen} onOpenChange={onAboutChange}>
            <DialogTrigger asChild>
              <button
                className="titlebar-button titlebar-help"
                aria-label="帮助"
                title="帮助 · 关于 Wintermute"
              >
                <CircleHelp size={17} />
              </button>
            </DialogTrigger>
            <DialogContent className="detail-dialog about-dialog">
              <DialogTitle>关于 Wintermute</DialogTitle>
              <p className="about-version">桌面版 · {version}</p>
              <DialogDescription>
                Wintermute 是连接个人 Agent 的桌面客户端。你可以在这里与 Agent
                对话、查看日程和设备通知。
              </DialogDescription>
            </DialogContent>
          </Dialog>
        </div>
      </header>
      {children}
      <div
        className="sidebar-divider"
        role="separator"
        tabIndex={0}
        aria-label="导航栏宽度"
        aria-orientation="vertical"
        aria-controls="app-sidebar"
        aria-valuemin={railWidth}
        aria-valuemax={maximum}
        aria-valuenow={width}
        aria-valuetext={compact ? '已收起' : width + ' 像素'}
        title="拖动调整导航栏宽度"
        onKeyDown={resizeWithKeyboard}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary || drag.current) return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { pointerId: event.pointerId, x: event.clientX, width }
          setPreview(width)
        }}
        onPointerMove={(event) => {
          const next = pointerWidth(event)
          if (next !== null) setPreview(next)
        }}
        onPointerUp={(event) => {
          const next = pointerWidth(event)
          if (next === null) return
          if (next !== drag.current?.width) commitWidth(next)
          endDrag()
        }}
        onLostPointerCapture={endDrag}
      />
    </div>
  )
}
