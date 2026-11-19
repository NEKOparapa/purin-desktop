import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { MemorySchedule } from '@/lib/desktop'

export function MemoryScheduleSettings({
  configured,
  revision,
}: {
  configured: boolean
  revision?: number
}) {
  const [plan, setPlan] = useState<MemorySchedule>()
  const [days, setDays] = useState('')
  const [time, setTime] = useState('')
  const [feedback, setFeedback] = useState('')
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const api = window.wintermute
  useEffect(() => {
    if (!configured || !api?.memorySchedule || revision === undefined) return
    let active = true
    api
      .memorySchedule()
      .then((value) => {
        if (!active) return
        setPlan(value)
        setDays(String(value.interval_days))
        setTime(value.local_time)
      })
      .catch((error) => {
        if (active) setFeedback(String(error.message || error))
      })
    return () => {
      active = false
    }
  }, [api, configured, revision, attempt])

  if (!configured || !api) return <p>连接后可设置此账号的整理计划。</p>
  if (!api.memorySchedule || revision === undefined)
    return <p>请更新桌面客户端以设置整理计划。</p>
  if (!plan)
    return (
      <div role="status">
        {feedback || '正在读取计划…'}
        {feedback && (
          <Button
            variant="outline"
            onClick={() => {
              setFeedback('')
              setAttempt(attempt + 1)
            }}
          >
            重试
          </Button>
        )}
      </div>
    )
  return (
    <form
      className="connection-form"
      onSubmit={async (event) => {
        event.preventDefault()
        if (saving) return
        setSaving(true)
        setFeedback('')
        try {
          setPlan(
            await api.memorySchedule({
              interval_days: Number(days),
              local_time: time,
              connectionRevision: revision,
            }),
          )
          setFeedback('整理计划已保存')
        } catch (error) {
          setFeedback(
            error instanceof Error ? error.message : '保存失败，请重试',
          )
        } finally {
          setSaving(false)
        }
      }}
    >
      <p>同一账号的所有设备共用此计划。</p>
      <label>
        间隔天数
        <input
          type="number"
          required
          min={1}
          max={3650}
          step={1}
          value={days}
          disabled={saving}
          onChange={(event) => {
            setDays(event.target.value)
            setFeedback('')
          }}
        />
      </label>
      <label>
        运行时间（{plan.timezone}）
        <input
          type="time"
          required
          value={time}
          disabled={saving}
          onChange={(event) => {
            setTime(event.target.value)
            setFeedback('')
          }}
        />
      </label>
      <p>下次整理　{plan.next_run_at.slice(0, 16).replace('T', ' ')}</p>
      <Button type="submit" disabled={saving}>
        {saving ? '正在保存…' : '保存计划'}
      </Button>
      {feedback && <p role="status">{feedback}</p>}
    </form>
  )
}
