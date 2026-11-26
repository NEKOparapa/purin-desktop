import { translateKnown, dateFormatter, t } from '@/lib/i18n'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import type { NoticeAlert, ScheduleEntry } from '@/lib/desktop'
import { NotificationInbox } from './notification-inbox'
import './schedule-calendar.css'

const monthLabel = dateFormatter({
  year: 'numeric',
  month: 'long',
})
const shortDayLabel = dateFormatter({
  month: 'numeric',
  day: 'numeric',
})
const weekdayLabel = dateFormatter({ weekday: 'long' })
const fullDate = dateFormatter({
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})
const time = dateFormatter({
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const exactTime = dateFormatter({
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, i + 1))
const weekdayShort = dateFormatter({ weekday: 'short' })

function dayKey(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')
}

function shiftDay(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta)
}

type CalendarProps = {
  connected: boolean
  settings: () => void
  focusNotice: NoticeAlert | null
}

type RangeData = {
  start: string
  end: string
  items: ScheduleEntry[] | null
  error: string
}

type AgendaFilter = 'all' | 'pending' | 'triggered'

function useScheduleEntries(
  connected: boolean,
  start: string,
  end: string,
  focusNotice: NoticeAlert | null,
) {
  const [result, setResult] = useState<RangeData | null>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const api = window.purin
    let active = true
    let busy = false
    async function load() {
      if (busy || !active) return
      setNow(new Date())
      if (!connected) return
      busy = true
      setResult((previous) => ({
        start,
        end,
        items:
          previous?.start === start && previous.end === end
            ? previous.items
            : null,
        error: '',
      }))
      try {
        if (!api?.schedule) throw new Error(t('请更新桌面端后查看日历。'))
        const entries = new Map<string, ScheduleEntry>()
        const cursors = new Set<string>()
        let cursor: string | undefined
        do {
          const page = await api.schedule({ start, end, cursor })
          if (!active) return
          for (const item of page.items) entries.set(item.id, item)
          if (page.next_cursor === null) break
          if (!page.next_cursor || cursors.has(page.next_cursor))
            throw new Error(t('日历分页读取失败，稍后会自动重试。'))
          cursor = page.next_cursor
          cursors.add(cursor)
        } while (active)
        const items = [...entries.values()].sort(
          (a, b) =>
            Date.parse(a.trigger_at) - Date.parse(b.trigger_at) ||
            a.id.localeCompare(b.id),
        )
        setResult({ start, end, items, error: '' })
      } catch (e) {
        const error =
          e instanceof Error
            ? translateKnown(e.message.replace(/^.*?Error: /, ''))
            : t('日历读取失败')
        if (active)
          setResult((previous) => ({
            start,
            end,
            items:
              previous?.start === start && previous.end === end
                ? previous.items
                : null,
            error,
          }))
      } finally {
        busy = false
      }
    }
    function refreshVisible() {
      if (document.visibilityState === 'visible') void load()
    }
    void load()
    const timer = window.setInterval(refreshVisible, 30_000)
    const stop = api?.onNotice?.(refreshVisible)
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      active = false
      stop?.()
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [connected, start, end, focusNotice])
  const current =
    result?.start === start && result.end === end
      ? result
      : { items: null, error: '' }
  return { ...current, now, today: dayKey(now) }
}

export function ScheduleCalendar({
  connected,
  settings,
  focusNotice,
}: CalendarProps) {
  const [choice, setChoice] = useState<{
    day: Date
    alert: NoticeAlert | null
  }>(() => ({ day: new Date(), alert: null }))
  const selected =
    focusNotice && focusNotice !== choice.alert
      ? new Date(focusNotice.notifyAt)
      : choice.day
  function select(day: Date) {
    setChoice({ day, alert: focusNotice })
    setAgendaFilter('all')
  }
  const [expanded, setExpanded] = useState(
    () => window.matchMedia('(min-width: 840px)').matches,
  )
  const [agendaFilter, setAgendaFilter] = useState<AgendaFilter>('all')
  const keyboardDay = useRef(false)
  const selectedButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (keyboardDay.current) selectedButton.current?.focus()
    keyboardDay.current = false
  }, [choice])
  const year = selected.getFullYear(),
    month = selected.getMonth()
  const first = new Date(year, month, 1)
  const days = new Date(year, month + 1, 0).getDate()
  const weekStart = shiftDay(selected, -((selected.getDay() + 6) % 7))
  const start = expanded ? first : weekStart
  const end = expanded ? new Date(year, month + 1, 1) : shiftDay(start, 7)
  const heading = monthLabel().formatRange(start, shiftDay(end, -1))
  const offset = expanded ? (first.getDay() + 6) % 7 : 0
  const trailing = expanded ? (7 - ((offset + days) % 7)) % 7 : 0
  const totalCells = expanded ? offset + days + trailing : 7
  const selectedKey = dayKey(selected)
  const { items, error, now, today } = useScheduleEntries(
    connected,
    start.toISOString(),
    end.toISOString(),
    focusNotice,
  )
  const byDay = useMemo(() => {
    const groups = new Map<string, ScheduleEntry[]>()
    for (const item of items ?? []) {
      const key = dayKey(new Date(item.trigger_at))
      const group = groups.get(key)
      if (group) group.push(item)
      else groups.set(key, [item])
    }
    return groups
  }, [items])

  const dayItems = byDay.get(selectedKey) ?? []
  const agenda = dayItems.filter((entry) => !entry.notification)
  const notices = dayItems.flatMap((entry) =>
    entry.notification ? [entry.notification] : [],
  )
  const mixedStates =
    agenda.some((item) => item.status === 'triggered') &&
    agenda.some((item) => item.status === 'scheduled')
  const filter = mixedStates ? agendaFilter : 'all'
  const visibleAgenda = agenda.filter(
    (item) =>
      filter === 'all' ||
      (filter === 'triggered') === (item.status === 'triggered'),
  )
  const next =
    selectedKey === today
      ? dayItems.find(
          (item) =>
            (item.notification
              ? item.notification.status === 'scheduled'
              : item.status === 'scheduled') &&
            Date.parse(item.trigger_at) >= now.getTime(),
        )
      : undefined
  const nearest =
    !dayItems.length && items?.length
      ? items.reduce((best, item) =>
          Math.abs(Date.parse(item.trigger_at) - selected.getTime()) <
          Math.abs(Date.parse(best.trigger_at) - selected.getTime())
            ? item
            : best,
        )
      : undefined

  function changePeriod(delta: number) {
    if (!expanded) {
      select(shiftDay(selected, 7 * delta))
      return
    }
    const last = new Date(year, month + delta + 1, 0).getDate()
    select(new Date(year, month + delta, Math.min(selected.getDate(), last)))
  }

  function dayKeys(e: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const weekday = (date.getDay() + 6) % 7
    const shifts: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -weekday,
      End: 6 - weekday,
    }
    const shift = shifts[e.key]
    if (shift === undefined) return
    e.preventDefault()
    keyboardDay.current = true
    select(shiftDay(date, shift))
  }

  return (
    <div className="schedule-layout">
      <section className="schedule-dates" aria-label={t('日历')}>
        <div className="calendar-toolbar">
          <h2
            className="calendar-dateline"
            aria-label={fullDate().format(selected)}
          >
            <strong>{String(selected.getDate()).padStart(2, '0')}</strong>
            <span>
              <small>{monthLabel().format(selected)}</small>
              <b>{weekdayLabel().format(selected)}</b>
            </span>
          </h2>
          <div className="month-switch">
            <button
              aria-label={expanded ? t('上个月') : t('上一周')}
              onClick={() => changePeriod(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="calendar-today"
              title={t('回到今天')}
              onClick={() => select(new Date())}
            >
              {t('今天')}
            </button>
            <button
              aria-label={expanded ? t('下个月') : t('下一周')}
              onClick={() => changePeriod(1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div
          id="schedule-dates"
          className="calendar-grid"
          role="group"
          aria-label={heading}
        >
          {weekdays.map((day) => (
            <span className="weekday" key={day.getDay()} aria-label={weekdayLabel().format(day)}>
              {weekdayShort().format(day)}
            </span>
          ))}
          {Array.from({ length: totalCells }, (_, i) => {
            const date = shiftDay(start, i - offset)
            const key = dayKey(date)
            const outside = expanded && date.getMonth() !== month
            const chosen = key === selectedKey
            const events = byDay.get(key) ?? []
            const noticeCount = events.filter(
              (item) => item.notification,
            ).length
            const agendaCount = events.length - noticeCount
            const counts =
              !outside && items
                ? t('，{0}项安排，{1}条通知', agendaCount, noticeCount)
                : ''
            const preview = events
              .slice(0, 3)
              .map(
                (e) =>
                  time().format(new Date(e.trigger_at)) +
                  ' ' +
                  (e.notification?.title ?? e.title),
              )
            return (
              <button
                key={key}
                className="calendar-cell"
                data-outside={outside}
                aria-label={
                  fullDate().format(date) +
                  (key === today ? t('，今天') : '') +
                  counts
                }
                title={[fullDate().format(date), ...preview].join('\n')}
                aria-pressed={chosen}
                aria-current={key === today ? 'date' : undefined}
                tabIndex={chosen ? 0 : -1}
                ref={chosen ? selectedButton : undefined}
                onClick={() => select(date)}
                onKeyDown={(e) => dayKeys(e, date)}
              >
                <span className="calendar-number">{date.getDate()}</span>
                <span className="calendar-marks" aria-hidden="true">
                  {agendaCount > 0 && <i className="agenda-mark" />}
                  {noticeCount > 0 && <i className="notice-mark" />}
                </span>
              </button>
            )
          })}
        </div>
        <footer className="calendar-foot">
          <span className="calendar-legend">
            <i className="agenda-mark" />
            {t('安排')}
            <i className="notice-mark" />
            {t('通知')}
          </span>
          <button
            className="calendar-mode"
            aria-controls="schedule-dates"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? t('收起月历') : t('展开月历')}
            <ChevronDown size={13} />
          </button>
        </footer>
      </section>
      <div className="calendar-details">
        {error && (
          <p className="calendar-error" role="alert">
            {error}
            {items && t(' 当前显示上次读取的安排。')}
          </p>
        )}
        {!connected ? (
          <div className="calendar-connect">
            <p>{t('连接主 Agent 后可查看安排和通知。')}</p>
            <button onClick={settings}>{t('打开连接设置')}</button>
          </div>
        ) : (
          <>
            <section className="calendar-agenda" aria-label={t('当日安排')}>
              <header className="agenda-heading">
                <h2>{t('当日安排')}{items && <small>{agenda.length}</small>}</h2>
                {mixedStates && (
                  <label className="agenda-filter">
                    <select
                      aria-label={t('筛选当日安排')}
                      value={filter}
                      onChange={(e) =>
                        setAgendaFilter(e.target.value as AgendaFilter)
                      }
                    >
                      <option value="all">{t('全部状态')}</option>
                      <option value="pending">{t('待触发')}</option>
                      <option value="triggered">{t('已触发')}</option>
                    </select>
                    <ChevronDown size={13} aria-hidden="true" />
                  </label>
                )}
              </header>
              {items === null || !agenda.length ? (
                <p className="agenda-empty" role="status">
                  {items
                    ? t('当天没有安排')
                    : error
                      ? t('尚未获取当天安排')
                      : t('正在读取安排…')}
                  {nearest && (
                    <button
                      className="calendar-nearest"
                      onClick={() => select(new Date(nearest.trigger_at))}
                    >{t('查看 {0} 日程', shortDayLabel().format(new Date(nearest.trigger_at)))} <ChevronRight size={13} />
                    </button>
                  )}
                </p>
              ) : (
                <ol>
                  {visibleAgenda.map((item) => (
                    <li key={item.id}>
                      <time dateTime={item.trigger_at}>
                        {(new Date(item.trigger_at).getSeconds()
                          ? exactTime()
                          : time()
                        ).format(new Date(item.trigger_at))}
                      </time>
                      <div className="agenda-entry">
                        <h3>{item.title}</h3>
                        {item.content && <p>{item.content}</p>}
                        <div className="agenda-meta">
                          <span>
                            {item.status === 'triggered' ? t('已触发') : t('待触发')}
                          </span>
                          <span>
                            {{
                              notify_agent: t('通知主 Agent'),
                              notify_device: t('发送设备通知'),
                            }[item.action] ?? item.action}
                          </span>
                          {next?.id === item.id && (
                            <span className="agenda-next">{t('下一项')}</span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <NotificationInbox
              key={selectedKey}
              nextId={next?.notification?.id}
              focusNotice={focusNotice}
              items={notices}
              loading={items === null && !error}
              loadError={!!error && items === null}
            />
          </>
        )}
      </div>
    </div>
  )
}
