import { translateKnown, dateFormatter, language, t } from '@/lib/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, Paperclip } from 'lucide-react'
import type { DeviceFile, DeviceNotice, NoticeAlert } from '@/lib/desktop'
import './notification-inbox.css'

const stamp = dateFormatter({
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const previewCount = 2
function size(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return +(bytes / 1024).toFixed(1) + ' KB'
  return +(bytes / 1048576).toFixed(1) + ' MB'
}
function message(e: unknown) {
  return e instanceof Error
    ? translateKnown(e.message.replace(/^.*?Error: /, ''))
    : t('读取失败，请重试。')
}

export function NotificationInbox({
  nextId,
  focusNotice,
  items,
  loading,
  loadError,
}: {
  nextId?: string
  focusNotice: NoticeAlert | null
  items: DeviceNotice[]
  loading: boolean
  loadError: boolean
}) {
  const [all, setAll] = useState(false)
  const [selection, setSelection] = useState<{
    id: string | null
    request: NoticeAlert | null
  } | null>(null)
  const expanded =
    selection?.request === focusNotice ? selection.id : focusNotice?.id
  const focusIndex = items.findIndex((n) => n.id === focusNotice?.id)
  const showAll =
    all || (expanded === focusNotice?.id && focusIndex >= previewCount)
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set())
  const [issue, setIssue] = useState('')
  const [working, setWorking] = useState('')
  const [fileStatus, setFileStatus] = useState<{
    noticeId: string
    text: string
  } | null>(null)
  const reading = useRef(new Set<string>())
  const requested = useRef<NoticeAlert | null>(null)
  const api = window.purin
  const markRead = useCallback(
    async (n: DeviceNotice) => {
      if (
        !api ||
        !n.in_inbox ||
        n.read_at ||
        reading.current.has(n.id) ||
        readIds.has(n.id)
      )
        return
      reading.current.add(n.id)
      try {
        await api.readNotification(n.id)
        setReadIds((ids) => new Set(ids).add(n.id))
        setIssue('')
      } catch (e) {
        setIssue(message(e))
      } finally {
        reading.current.delete(n.id)
      }
    },
    [api, readIds],
  )
  useEffect(() => {
    if (!focusNotice || requested.current === focusNotice || focusIndex < 0)
      return
    requested.current = focusNotice
    void markRead(items[focusIndex])
    document
      .getElementById('notice-' + focusNotice.id)
      ?.scrollIntoView({ block: 'nearest' })
  }, [focusNotice, focusIndex, items, markRead])
  async function saveFile(id: string, file: DeviceFile) {
    if (!api || working) return
    setWorking(file.id)
    setFileStatus(null)
    try {
      const r = await api.downloadNotificationFile({ notificationId: id, file })
      if (r.saved) setFileStatus({ noticeId: id, text: t('已保存 ') + file.name })
    } catch (e) {
      setFileStatus({ noticeId: id, text: message(e) })
    } finally {
      setWorking('')
    }
  }
  const unreadCount = items.filter(
    (n) => n.in_inbox && !n.read_at && !readIds.has(n.id) && !n.expired,
  ).length

  return (
    <section className="notice-page" aria-labelledby="notices-heading">
      <header className="notice-toolbar">
        <h2 id="notices-heading">
          {t('当日通知')}{!loading && !loadError && <small>{items.length}</small>}
        </h2>
        {items.length > previewCount ? (
          <button
            type="button"
            className="notice-toggle"
            aria-controls="schedule-notices"
            aria-expanded={showAll}
            onClick={() => {
              setAll(!showAll)
              if (showAll) setSelection({ id: null, request: focusNotice })
            }}
          >
            {showAll ? t('收起') : t('显示全部 {0} 条', items.length)}
          </button>
        ) : (
          unreadCount > 0 && (
            <span className="notice-unread-count">{unreadCount}{t(' 条未读')}</span>
          )
        )}
      </header>
      {issue && (
        <p className="notice-error" role="alert">
          {issue}
        </p>
      )}
      {loading ? (
        <p className="notice-empty-strip">{t('正在读取通知…')}</p>
      ) : (
        !items.length && (
          <p className="notice-empty-strip">
            {loadError ? t('尚未获取当日通知') : t('当日没有通知')}
          </p>
        )
      )}
      {items.length > 0 && (
        <div className="notice-list" id="schedule-notices">
          {(showAll ? items : items.slice(0, previewCount)).map((n) => {
            const open = expanded === n.id
            const unread =
              n.in_inbox && !n.read_at && !readIds.has(n.id) && !n.expired
            const state = {
              scheduled: t('待发送'),
              sent: t('已发送'),
              partial: t('部分发送'),
              failed: t('发送失败'),
            }[n.status]
            return (
              <article
                id={'notice-' + n.id}
                key={n.id}
                className="notice-entry"
                data-unread={unread}
                data-open={open}
                data-expired={n.expired}
              >
                <button
                  type="button"
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
                  <time
                    dateTime={n.notify_at}
                    title={new Date(n.notify_at).toLocaleString(language())}
                  >
                    <span className="sr-only">{t('通知时间 ')}</span>
                    {stamp().format(new Date(n.notify_at))}
                  </time>
                  <span className="notice-heading">
                    <strong>
                      {n.title}
                      {unread && (
                        <i className="notice-unread">
                          <span className="sr-only">{t('未读')}</span>
                        </i>
                      )}
                    </strong>
                    {!open && n.body && (
                      <span className="notice-preview">{n.body}</span>
                    )}
                    <span className="notice-delivery">
                      <small>{n.expired ? t('已过期') : state}</small>
                      {n.target_names.length > 0 && (
                        <small>{t('目标设备 · ')}{n.target_names.join(language() === 'en' ? ', ' : '、')}</small>
                      )}
                      {n.attachments.length > 0 && (
                        <small>
                          <Paperclip size={12} />
                          {t('{0} 个附件', n.attachments.length)}</small>
                      )}
                      {nextId === n.id && <small>{t('下一项')}</small>}
                    </span>
                  </span>
                  <ChevronDown
                    size={14}
                    className="notice-chevron"
                    aria-hidden="true"
                  />
                </button>
                {open && (
                  <div className="notice-details">
                    {n.body && <p>{n.body}</p>}
                    {n.attachments.length > 0 && (
                      <ul aria-label={t('附件')}>
                        {n.attachments.map((f) => (
                          <li key={f.id}>
                            <button
                              type="button"
                              disabled={!!working}
                              onClick={() => void saveFile(n.id, f)}
                            >
                              <Download size={14} aria-hidden="true" />
                              <span className="notice-file-name">{f.name}</span>
                              <small>
                                {working === f.id
                                  ? t('保存中…')
                                  : size(f.size_bytes)}
                              </small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {fileStatus?.noticeId === n.id && (
                      <small className="notice-file-status" role="status">
                        {fileStatus.text}
                      </small>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
