import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, Paperclip } from 'lucide-react'
import type { DeviceFile, DeviceNotice, NoticeAlert } from '@/lib/desktop'
import './notification-inbox.css'

const stamp = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  year: 'numeric',
})
const previewCount = 2
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
  focusNotice,
}: {
  connected: boolean
  focusNotice: NoticeAlert | null
}) {
  const [items, setItems] = useState<DeviceNotice[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [listView, setListView] = useState<{
    open: boolean
    request: NoticeAlert | null
  }>({ open: false, request: null })
  const focusIndex = focusNotice
    ? items.findIndex((n) => n.id === focusNotice.id)
    : -1
  const showAll =
    listView.open ||
    (listView.request !== focusNotice && focusIndex >= previewCount)
  const [selection, setSelection] = useState<{
    id: string | null
    request: NoticeAlert | null
  } | null>(null)
  const expanded =
    selection?.request === focusNotice ? selection.id : focusNotice?.id
  const [loading, setLoading] = useState(true)
  const [issue, setIssue] = useState('')
  const [working, setWorking] = useState('')
  const [fileStatus, setFileStatus] = useState<{
    noticeId: string
    text: string
  } | null>(null)
  const live = useRef(false)
  const cache = useRef<{ items: DeviceNotice[]; next: string | null }>({
    items: [],
    next: null,
  })
  const reading = useRef(new Set<string>())
  const load = useRef<(cursor?: string) => boolean>(() => false)
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
    load.current = (after) => {
      if (!active || busy) return false
      void fetchPage(after)
      return true
    }
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
  const visitedCursors = useRef(new Set<string>())
  useEffect(() => {
    visitedCursors.current.clear()
    if (
      focusNotice &&
      !cache.current.items.some((item) => item.id === focusNotice.id)
    )
      load.current()
  }, [focusNotice])
  const requested = useRef<NoticeAlert | null>(null)
  useEffect(() => {
    if (!focusNotice || requested.current === focusNotice) return
    if (focusIndex < 0) {
      if (issue) visitedCursors.current.clear()
      else if (
        cursor &&
        !visitedCursors.current.has(cursor) &&
        load.current(cursor)
      ) {
        visitedCursors.current.add(cursor)
      }
      return
    }
    if (focusIndex >= previewCount && !showAll) return
    const item = items[focusIndex]
    requested.current = focusNotice
    void markRead(item)
    document
      .getElementById('notice-' + item.id)
      ?.scrollIntoView({ block: 'nearest' })
  }, [focusNotice, focusIndex, items, cursor, issue, showAll, markRead])
  async function saveFile(id: string, file: DeviceFile) {
    if (!api || working) return
    setWorking(file.id)
    setFileStatus(null)
    try {
      const r = await api.downloadNotificationFile({ notificationId: id, file })
      if (live.current && r.saved)
        setFileStatus({ noticeId: id, text: '已保存 ' + file.name })
    } catch (e) {
      if (live.current) setFileStatus({ noticeId: id, text: message(e) })
    } finally {
      if (live.current) setWorking('')
    }
  }
  return (
    <section className="notice-page" aria-labelledby="notices-heading">
      <header className="notice-toolbar">
        <h2 id="notices-heading">最近通知</h2>
        {connected && (items.length > previewCount || cursor) && (
          <button
            className="notice-toggle"
            aria-controls="schedule-notices"
            aria-expanded={showAll}
            onClick={() =>
              setListView({ open: !showAll, request: focusNotice })
            }
          >
            {showAll
              ? '收起'
              : cursor
                ? '显示全部'
                : `显示全部 ${items.length} 条`}
          </button>
        )}
      </header>
      {!connected ? (
        <p className="notice-empty">连接后可查看发给这台设备的通知。</p>
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
          <div className="notice-list" id="schedule-notices">
            {(showAll ? items : items.slice(0, previewCount)).map((n) => {
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
                      setSelection({
                        id: open ? null : n.id,
                        request: focusNotice,
                      })
                      setFileStatus(null)
                      if (!open) void markRead(n)
                    }}
                  >
                    <span className="notice-heading">
                      <span className="notice-title">
                        <strong>{n.title}</strong>
                        {late ? (
                          <small>已过期</small>
                        ) : (
                          !n.read_at && <small className="sr-only">未读</small>
                        )}
                      </span>
                      {!open && n.body && (
                        <span className="notice-preview">{n.body}</span>
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
                      {fileStatus?.noticeId === n.id && (
                        <small role="status">{fileStatus.text}</small>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
          {showAll && cursor && (
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
