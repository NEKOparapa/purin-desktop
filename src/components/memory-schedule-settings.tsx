import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { MemorySchedule } from '@/lib/desktop'

type ScheduleApi = Pick<NonNullable<Window['wintermute']>, 'memorySchedule'>
type ScheduleValues = Pick<MemorySchedule, 'interval_days' | 'local_time'>
type ScheduleDraft = { days: string; time: string }

function readDraft({ days, time }: ScheduleDraft): ScheduleValues | undefined {
  const interval = Number(days)
  if (!Number.isInteger(interval) || interval < 1 || interval > 3650) return
  if (!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) return
  return { interval_days: interval, local_time: time }
}

function sameSchedule(a: ScheduleValues, b: ScheduleValues | undefined) {
  return a.interval_days === b?.interval_days && a.local_time === b?.local_time
}

function scheduleError(error: unknown, fallback: string) {
  return error instanceof Error
    ? error.message.replace(/^.*?Error: /, '')
    : fallback
}

export function MemoryScheduleSettings({
  configured,
  revision,
}: {
  configured: boolean
  revision?: number
}) {
  const api = window.wintermute
  if (!configured || !api) return <p>连接后可设置此账号的整理计划。</p>
  if (!api.memorySchedule || revision === undefined)
    return <p>请更新桌面客户端以设置整理计划。</p>
  return <ConnectedMemorySchedule api={api} revision={revision} />
}

function ConnectedMemorySchedule({
  api,
  revision,
}: {
  api: ScheduleApi
  revision: number
}) {
  const [plan, setPlan] = useState<MemorySchedule>()
  const [draft, setDraft] = useState<ScheduleDraft>({ days: '', time: '' })
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(false)
  const latestDraft = useRef(draft)
  const latestSent = useRef<ScheduleValues>(undefined)
  const saveTimer = useRef<number>(undefined)

  const saveDraft = useCallback(async () => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = undefined
    const submitted = readDraft(latestDraft.current)
    if (!submitted || sameSchedule(submitted, latestSent.current)) return
    latestSent.current = submitted
    if (mounted.current) {
      setSaving(true)
      setSaveError('')
    }
    try {
      const saved = await api.memorySchedule({
        ...submitted,
        connectionRevision: revision,
      })
      if (!mounted.current) return
      setPlan(saved)
      if (latestSent.current === submitted) setSaving(false)
    } catch (error) {
      if (!mounted.current || latestSent.current !== submitted) return
      latestSent.current = undefined
      setSaving(false)
      if (sameSchedule(submitted, readDraft(latestDraft.current))) {
        setSaveError(scheduleError(error, '请检查连接后重试。'))
      }
    }
  }, [api, revision])

  useEffect(() => {
    mounted.current = true
    let active = true
    api
      .memorySchedule()
      .then((value) => {
        if (!active) return
        latestSent.current = value
        const loaded = {
          days: String(value.interval_days),
          time: value.local_time,
        }
        latestDraft.current = loaded
        setDraft(loaded)
        setPlan(value)
      })
      .catch((error) => {
        if (active) setLoadError(scheduleError(error, '无法读取整理计划。'))
      })
    return () => {
      active = false
      mounted.current = false
      if (saveTimer.current !== undefined) void saveDraft()
    }
  }, [api, attempt, saveDraft])

  function changeDraft(next: ScheduleDraft) {
    latestDraft.current = next
    setDraft(next)
    setSaveError('')
    window.clearTimeout(saveTimer.current)
    saveTimer.current = undefined
    const values = readDraft(next)
    if (values && !sameSchedule(values, latestSent.current)) {
      saveTimer.current = window.setTimeout(() => void saveDraft(), 450)
    }
  }

  if (!plan)
    return (
      <div role="status">
        {loadError || '正在读取计划…'}
        {loadError && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setLoadError('')
              setAttempt((current) => current + 1)
            }}
          >
            重试
          </Button>
        )}
      </div>
    )

  const values = readDraft(draft)
  const feedback = !values
    ? '请输入 1 至 3650 的整数天数和有效的运行时间。'
    : saveError
      ? `同步失败 · ${saveError}`
      : saving || !sameSchedule(values, plan)
        ? '正在保存并同步…'
        : '已与后端同步'

  return (
    <div className="connection-form">
      <p className="settings-note">
        修改后自动保存。同一账号的所有设备共用此计划。
      </p>
      <label>
        间隔天数
        <input
          type="number"
          required
          min={1}
          max={3650}
          step={1}
          value={draft.days}
          onChange={(event) =>
            changeDraft({ ...latestDraft.current, days: event.target.value })
          }
        />
      </label>
      <label>
        运行时间（{plan.timezone}）
        <input
          type="time"
          required
          value={draft.time}
          onChange={(event) =>
            changeDraft({ ...latestDraft.current, time: event.target.value })
          }
        />
      </label>
      <p>下次整理　{plan.next_run_at.slice(0, 16).replace('T', ' ')}</p>
      <p className={saveError ? 'issue' : 'settings-note'} role="status">
        {feedback}
      </p>
      {saveError && values && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void saveDraft()}
        >
          重试同步
        </Button>
      )}
    </div>
  )
}
