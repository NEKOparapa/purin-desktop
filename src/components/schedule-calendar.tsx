import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Bell, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import type { NoticeAlert, ScheduleEntry } from '@/lib/desktop'
import { NotificationInbox } from './notification-inbox'
import './schedule-calendar.css'

const monthLabel = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
})
const dayLabel = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
})
const weekdayLabel = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' })
const fullDate = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})
const time = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const exactTime = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
const weekdays = ['一', '二', '三', '四', '五', '六', '日']

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

function useScheduleEntries(connected: boolean, start: string, end: string) {
  const [result, setResult] = useState<RangeData | null>(null)
  const [today, setToday] = useState(() => dayKey(new Date()))
  useEffect(() => {
    const api = window.wintermute
    let active = true
    let busy = false
    async function load() {
      if (busy || !active) return
      setToday(dayKey(new Date()))
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
        if (!api?.schedule) throw new Error('请更新桌面端后查看日历。')
        const entries = new Map<string, ScheduleEntry>()
        const cursors = new Set<string>()
        let cursor: string | undefined
        do {
          const page = await api.schedule({ start, end, cursor })
          if (!active) return
          for (const item of page.items) entries.set(item.id, item)
          if (page.next_cursor === null) break
          if (!page.next_cursor || cursors.has(page.next_cursor))
            throw new Error('日历分页读取失败，稍后会自动重试。')
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
            ? e.message.replace(/^.*?Error: /, '')
            : '日历读取失败'
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
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [connected, start, end])
  const current =
    result?.start === start && result.end === end
      ? result
      : { items: null, error: '' }
  return { ...current, today }
}

export function ScheduleCalendar({
  connected,
  settings,
  focusNotice,
}: CalendarProps) {
  const [selected, select] = useState(() => new Date())
  const [expanded, setExpanded] = useState(false)
  const keyboardDay = useRef(false)
  const selectedButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (keyboardDay.current) selectedButton.current?.focus()
    keyboardDay.current = false
  }, [selected])
  const year = selected.getFullYear(),
    month = selected.getMonth()
  const first = new Date(year, month, 1)
  const days = new Date(year, month + 1, 0).getDate()
  const weekStart = shiftDay(selected, -((selected.getDay() + 6) % 7))
  const start = expanded ? first : weekStart
  const end = expanded ? new Date(year, month + 1, 1) : shiftDay(start, 7)
  const heading = monthLabel.formatRange(start, shiftDay(end, -1))
  const offset = expanded ? (first.getDay() + 6) % 7 : 0
  const selectedKey = dayKey(selected)
  const { items, error, today } = useScheduleEntries(
    connected,
    start.toISOString(),
    end.toISOString(),
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
  const agenda = byDay.get(selectedKey) ?? []
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
    <>
      <section className="schedule-dates" aria-label="日历">
        <div className="calendar-toolbar">
          <h2>{heading}</h2>
          <div className="calendar-controls">
            <div className="month-switch">
              <button
                aria-label={expanded ? '上个月' : '上一周'}
                title={expanded ? '上个月' : '上一周'}
                onClick={() => changePeriod(-1)}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="calendar-today"
                title="回到今天"
                onClick={() => select(new Date())}
              >
                {expanded
                  ? month + 1 + '月'
                  : selectedKey === today
                    ? '今天'
                    : selected.getDate() + '日'}
              </button>
              <button
                aria-label={expanded ? '下个月' : '下一周'}
                title={expanded ? '下个月' : '下一周'}
                onClick={() => changePeriod(1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <button
              className="calendar-mode calendar-control"
              aria-expanded={expanded}
              aria-controls="schedule-dates"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '收起月历' : '展开月历'}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        {error && (
          <p className="calendar-error" role="alert">
            {error}
            {items && ' 当前显示上次读取的安排。'}
          </p>
        )}
        <div
          id="schedule-dates"
          className="calendar-grid"
          role="group"
          aria-label={heading}
        >
          {weekdays.map((day) => (
            <span key={day} className="weekday">
              周{day}
            </span>
          ))}
          {Array.from({ length: expanded ? offset + days : 7 }, (_, i) => {
            const num = i - offset + 1
            if (num < 1)
              return <div key={i} className="day-gap" aria-hidden="true" />
            const date = shiftDay(start, num - 1)
            const key = dayKey(date),
              chosen = key === selectedKey
            const events = byDay.get(key) ?? []
            return (
              <button
                key={key}
                className="calendar-cell"
                aria-label={
                  fullDate.format(date) +
                  (items ? '，' + events.length + '项安排' : '')
                }
                aria-pressed={chosen}
                aria-current={key === today ? 'date' : undefined}
                tabIndex={chosen ? 0 : -1}
                ref={chosen ? selectedButton : undefined}
                onClick={() => select(date)}
                onKeyDown={(e) => dayKeys(e, date)}
              >
                <span
                  className="calendar-number"
                  data-events={events.length > 0}
                >
                  {date.getDate()}
                </span>
              </button>
            )
          })}
        </div>
      </section>
      <NotificationInbox connected={connected} focusNotice={focusNotice} />
      <section className="calendar-agenda" aria-label="当天安排">
        <header className="agenda-heading">
          <h2>{dayLabel.format(selected)}的安排</h2>
          <span title={'本机时间 · ' + time.resolvedOptions().timeZone}>
            {weekdayLabel.format(selected)}
          </span>
        </header>
        {!connected ? (
          <div className="calendar-connect">
            <p>连接后可查看主 Agent 的安排。</p>
            <button className="calendar-control" onClick={settings}>
              打开连接设置
            </button>
          </div>
        ) : items === null ? (
          <p className="agenda-empty" role="status">
            {error ? '尚未获取当天安排' : '正在读取安排…'}
          </p>
        ) : agenda.length === 0 ? (
          <p className="agenda-empty">当天没有安排</p>
        ) : (
          <ol>
            {agenda.map((item) => {
              const at = new Date(item.trigger_at)
              return (
                <li key={item.id}>
                  <time dateTime={item.trigger_at}>
                    {(at.getSeconds() ? exactTime : time).format(at)}
                  </time>
                  <div className="agenda-entry">
                    <h3>{item.title}</h3>
                    {item.content && <p>{item.content}</p>}
                    <div className="agenda-action">
                      <Bell size={12} />
                      {item.action === 'notify_agent'
                        ? '通知主 Agent'
                        : item.action}
                    </div>
                  </div>
                  <span
                    className="agenda-status"
                    data-triggered={item.status === 'triggered'}
                  >
                    {item.status === 'triggered' ? '已触发' : '待触发'}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </>
  )
}
