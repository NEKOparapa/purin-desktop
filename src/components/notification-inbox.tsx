import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, Paperclip, RotateCw } from 'lucide-react'
import type { DeviceFile, DeviceNotice } from '@/lib/desktop'
import './notification-inbox.css'

const stamp = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  year: 'numeric',
})
function size(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return +(bytes / 1024).toFixed(1) + ' KB'
  return +(bytes / 1048576).toFixed(1) + ' MB'
}
function message(e: unknown) {
  return e instanceof Error
    ? e.message.replace(/^.*?Error: /, '')
    : '读取失败，请重试。'
}

export function NotificationInbox({
  connected,
  settings,
  focusId,
}: {
  connected: boolean
  settings: () => void
  focusId: string | null
}) {
  const [items, setItems] = useState<DeviceNotice[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(focusId)
  const [loading, setLoading] = useState(true)
  const [issue, setIssue] = useState('')
  const [working, setWorking] = useState('')
  const [fileStatus, setFileStatus] = useState('')
  const live = useRef(false)
  const cache = useRef<{ items: DeviceNotice[]; next: string | null }>({
    items: [],
    next: null,
  })
  const reading = useRef(new Set<string>())
  const load = useRef<(cursor?: string) => void>(() => {})
  const api = window.wintermute
  useEffect(() => {
    if (!connected || !api?.notificationPage) return
    let active = true,
      busy = false
    live.current = true
    async function fetchPage(after?: string) {
      if (!active || busy) return
      busy = true
      try {
        const page = await api!.notificationPage(after)
        if (!active) return
        const previous = cache.current
        const tail = page.items.at(-1)
        const overlap =
          !after && tail && page.next_cursor
            ? previous.items.findIndex((n) => n.id === tail.id)
            : -1
        const merged = after
          ? [
              ...new Map(
                [...previous.items, ...page.items].map((n) => [n.id, n]),
              ).values(),
            ]
          : overlap >= 0
            ? [...page.items, ...previous.items.slice(overlap + 1)]
            : page.items
        const next = overlap >= 0 ? previous.next : page.next_cursor
        cache.current = { items: merged, next }
        setItems(merged)
        setCursor(next)
        setIssue('')
      } catch (e) {
        if (active) setIssue(message(e))
      } finally {
        busy = false
        if (active) setLoading(false)
      }
    }
    load.current = fetchPage
    const refresh = () => {
      if (document.visibilityState === 'visible') void fetchPage()
    }
    void fetchPage()
    const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      live.current = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [connected, api])

  const markRead = useCallback(
    async (n: DeviceNotice) => {
      if (!api || n.read_at || reading.current.has(n.id)) return
      reading.current.add(n.id)
      try {
        await api.readNotification(n.id)
        if (live.current) {
          const now = new Date().toISOString()
          cache.current.items = cache.current.items.map((i) =>
            i.id === n.id ? { ...i, read_at: now } : i,
          )
          setItems(cache.current.items)
          setIssue('')
        }
      } catch (e) {
        if (live.current) setIssue(message(e))
      } finally {
        reading.current.delete(n.id)
      }
    },
    [api],
  )
  const requested = useRef<string | null>(null)
  useEffect(() => {
    if (!focusId || requested.current === focusId) return
    const item = items.find((n) => n.id === focusId)
    if (!item) return
    requested.current = focusId
    void markRead(item)
    document
      .getElementById('notice-' + item.id)
      ?.scrollIntoView({ block: 'nearest' })
  }, [focusId, items, markRead])
  async function saveFile(id: string, file: DeviceFile) {
    if (!api || working) return
    setWorking(file.id)
    setFileStatus('')
    try {
      const r = await api.downloadNotificationFile({ notificationId: id, file })
      if (live.current && r.saved) setFileStatus('已保存 ' + file.name)
    } catch (e) {
      if (live.current) setFileStatus(message(e))
    } finally {
      if (live.current) setWorking('')
    }
  }
  return (
    <section className="notice-page" aria-label="设备通知">
      <header className="page-heading">
        <h1>通知</h1>
        {connected && (
          <button
            className="notice-refresh"
            onClick={() => load.current()}
            aria-label="刷新通知"
          >
            <RotateCw size={16} />
          </button>
        )}
      </header>
      {!connected ? (
        <div className="notice-empty">
          连接后可查看发给这台设备的通知。
          <button onClick={settings}>打开连接设置</button>
        </div>
      ) : (
        <>
          {issue && (
            <p className="notice-error" role="alert">
              {issue}
            </p>
          )}
          {loading ? (
            <p className="notice-empty">正在读取通知…</p>
          ) : (
            !issue && !items.length && <p className="notice-empty">暂无通知</p>
          )}
          <div className="notice-list">
            {items.map((n) => {
              const open = expanded === n.id
              const late = n.expired
              return (
                <article
                  id={'notice-' + n.id}
                  key={n.id}
                  className="notice-entry"
                  data-unread={!n.read_at}
                >
                  <button
                    className="notice-summary"
                    aria-expanded={open}
                    onClick={() => {
                      setExpanded(open ? null : n.id)
                      setFileStatus('')
                      if (!open) void markRead(n)
                    }}
                  >
                    <span className="notice-heading">
                      <strong>{n.title}</strong>
                      {late ? (
                        <small>已过期</small>
                      ) : (
                        !n.read_at && <small>未读</small>
                      )}
                    </span>
                    <span className="notice-meta">
                      {n.attachments.length > 0 && (
                        <span>
                          <Paperclip size={13} />
                          {n.attachments.length}
                        </span>
                      )}
                      <time dateTime={n.created_at}>
                        {stamp.format(new Date(n.created_at))}
                      </time>
                      <ChevronDown
                        size={15}
                        className={open ? 'rotated' : ''}
                      />
                    </span>
                  </button>
                  {open && (
                    <div className="notice-details">
                      <p>{n.body}</p>
                      {n.attachments.length > 0 && (
                        <ul aria-label="附件">
                          {n.attachments.map((f) => (
                            <li key={f.id}>
                              <button
                                disabled={!!working}
                                onClick={() => void saveFile(n.id, f)}
                              >
                                <Download size={15} />
                                <span>{f.name}</span>
                                <small>
                                  {working === f.id
                                    ? '保存中…'
                                    : size(f.size_bytes)}
                                </small>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {fileStatus && <small role="status">{fileStatus}</small>}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
          {cursor && (
            <button
              className="notice-more"
              onClick={() => load.current(cursor)}
            >
              加载更早通知
            </button>
          )}
        </>
      )}
    </section>
  )
}
