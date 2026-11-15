import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RotateCw,
} from 'lucide-react'
import type { ScheduleEntry } from '@/lib/desktop'
import './schedule-calendar.css'

const monthLabel = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
})
const dayLabel = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
})
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

type CalendarProps = { connected: boolean; settings: () => void }

type MonthData = {
  start: string
  items: ScheduleEntry[] | null
  error: string
  loading: boolean
}

function useMonthEntries(start: string, end: string) {
  const [result, setResult] = useState<MonthData | null>(null)
  const [today, setToday] = useState(() => dayKey(new Date()))
  const reload = useRef<() => void>(() => {})
  useEffect(() => {
    const api = window.wintermute
    let active = true
    let busy = false
    async function load() {
      if (busy || !active) return
      busy = true
      setToday(dayKey(new Date()))
      setResult((previous) => ({
        start,
        items: previous?.start === start ? previous.items : null,
        error: '',
        loading: true,
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
            throw new Error('日历分页读取失败，请刷新。')
          cursor = page.next_cursor
          cursors.add(cursor)
        } while (active)
        const items = [...entries.values()].sort(
          (a, b) =>
            Date.parse(a.trigger_at) - Date.parse(b.trigger_at) ||
            a.id.localeCompare(b.id),
        )
        setResult({ start, items, error: '', loading: false })
      } catch (e) {
        const error =
          e instanceof Error
            ? e.message.replace(/^.*?Error: /, '')
            : '日历读取失败'
        if (active)
          setResult((previous) => ({
            start,
            items: previous?.start === start ? previous.items : null,
            error,
            loading: false,
          }))
      } finally {
        busy = false
      }
    }
    function refreshVisible() {
      if (document.visibilityState === 'visible') void load()
    }
    reload.current = load
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
  }, [start, end])
  const current =
    result?.start === start ? result : { items: null, error: '', loading: true }
  return { ...current, today, refresh: () => reload.current() }
}

export function ScheduleCalendar({ connected, settings }: CalendarProps) {
  return (
    <section className="schedule-page" aria-label="日历">
      <div className="schedule-inner">
        <header className="page-heading">
          <h1>日历</h1>
        </header>
        {connected ? (
          <CalendarMonth />
        ) : (
          <div className="calendar-connect">
            <CalendarDays size={28} strokeWidth={1.4} />
            <p>连接后可查看主 Agent 的安排。</p>
            <button className="calendar-control" onClick={settings}>
              打开连接设置
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function CalendarMonth() {
  const [selected, select] = useState(() => new Date())
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
  const offset = (first.getDay() + 6) % 7
  const selectedKey = dayKey(selected)
  const { items, error, loading, today, refresh } = useMonthEntries(
    first.toISOString(),
    new Date(year, month + 1, 1).toISOString(),
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
  function changeMonth(delta: number) {
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
    select(new Date(year, month, date.getDate() + shift))
  }

  return (
    <>
      <div className="calendar-toolbar">
        <h2>{monthLabel.format(first)}</h2>
        <div className="calendar-controls">
          <button
            onClick={() => select(new Date())}
            className="calendar-control"
          >
            今天
          </button>
          <div className="month-switch">
            <button
              aria-label="上个月"
              title="上个月"
              onClick={() => changeMonth(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              aria-label="下个月"
              title="下个月"
              onClick={() => changeMonth(1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            className="calendar-refresh"
            aria-label="刷新日历"
            title="刷新日历"
            onClick={refresh}
            disabled={loading}
          >
            <RotateCw size={15} />
          </button>
        </div>
      </div>
      {error && (
        <p className="calendar-error" role="alert">
          {error}
          {items && ' 当前显示上次读取的安排。'}
        </p>
      )}
      <div className="calendar-layout">
        <div
          className="calendar-grid"
          role="group"
          aria-label={monthLabel.format(first)}
        >
          {weekdays.map((day) => (
            <span key={day} className="weekday">
              周{day}
            </span>
          ))}
          {Array.from(
            { length: Math.ceil((offset + days) / 7) * 7 },
            (_, i) => {
              const num = i - offset + 1
              if (num < 1 || num > days)
                return <div key={i} className="day-gap" aria-hidden="true" />
              const date = new Date(year, month, num)
              const key = dayKey(date),
                chosen = key === selectedKey
              const events = byDay.get(key) ?? []
              return (
                <button
                  key={i}
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
                  <span className="calendar-number">{num}</span>
                  {events.length > 0 && (
                    <span className="cell-event" title={events[0].title}>
                      {events[0].title}
                    </span>
                  )}
                  {events.length > 1 && <small>+{events.length - 1}</small>}
                </button>
              )
            },
          )}
        </div>
        <section className="calendar-agenda" aria-label="当天安排">
          <h2>{dayLabel.format(selected)}</h2>
          <p className="agenda-zone">
            本机时间 · {time.resolvedOptions().timeZone}
          </p>
          {items === null ? (
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
                    <div className="agenda-time">
                      <time dateTime={item.trigger_at}>
                        {(at.getSeconds() ? exactTime : time).format(at)}
                      </time>
                      <span
                        className="agenda-status"
                        data-triggered={item.status === 'triggered'}
                      >
                        {item.status === 'triggered' ? '已触发' : '待触发'}
                      </span>
                    </div>
                    <h3>{item.title}</h3>
                    {item.content && <p>{item.content}</p>}
                    <div className="agenda-action">
                      <Bell size={12} />
                      {item.action === 'notify_agent'
                        ? '通知主 Agent'
                        : item.action}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </div>
    </>
  )
}
