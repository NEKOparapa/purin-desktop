import type { HistoryItem, HistoryFile } from '@/lib/desktop'
import { Files } from './history-files'
export type PerceptionMode = 'formatted' | 'raw' | 'compressed'

const labels: Record<string, string> = {
  'mobile.location': '地点',
  'mobile.app_activity': '移动端活动',
  domain: '网站',
  title: '标题',
  window_title: '窗口',
  foreground_app: '应用',
  activity: '活动',
  duration_seconds: '停留秒数',
  started_at: '开始时间',
  ended_at: '结束时间',
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

const clock = new Intl.DateTimeFormat('zh-CN', {
  timeStyle: 'medium',
  hour12: false,
})
const dateTime = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'medium',
  hour12: false,
})

function time(value: unknown, date = false) {
  const ts = text(value)
  if (!ts || !Number.isFinite(Date.parse(ts))) return ts
  return (date ? dateTime : clock).format(new Date(ts))
}

function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const rest = seconds % 60
  return [
    hours && hours + ' 小时',
    minutes && minutes + ' 分钟',
    (rest || !seconds) && rest + ' 秒',
  ]
    .filter(Boolean)
    .join(' ')
}

function DesktopSpan({
  value,
  files,
  status,
  total,
}: {
  value: Record<string, unknown>
  files: HistoryFile[]
  status: string
  total: number
}) {
  const objects = Array.isArray(value.work_objects)
    ? value.work_objects.map(record)
    : []
  const visual = Array.isArray(value.visual_observations)
    ? value.visual_observations.map(record)
    : []
  const remaining = [...files]
  const frames = visual.map((entry) => {
    const index = remaining.findIndex(file => file.id.endsWith(':frame:' + entry.frame_index))
    return {
      entry,
      file: index < 0 ? undefined : remaining.splice(index, 1)[0],
    }
  })
  for (const file of remaining) {
    frames.push({
      entry: { occurred_at: file.occurred_at, window_title: file.window_title },
      file,
    })
  }
  const timeline = [
    ...objects.map(entry => ({ kind: 'object', entry, file: undefined })),
    ...frames.map(frame => ({ kind: 'frame', ...frame })),
  ].sort((a, b) => Date.parse(text(a.entry.occurred_at)) - Date.parse(text(b.entry.occurred_at)))
  const start = text(value.started_at),
    end = text(value.ended_at)
  const crossesDay =
    start &&
    end &&
    new Date(start).toDateString() !== new Date(end).toDateString()
  return (
    <>
      <div className="perception-title">
        <h3>{text(value.foreground_app) || '桌面应用'}</h3>
        {typeof value.duration_seconds === 'number' && (
          <span>停留 {duration(value.duration_seconds)}</span>
        )}
      </div>
      <div className="perception-interval">
        {[time(start, !!crossesDay), time(end, !!crossesDay)]
          .filter(Boolean)
          .join(' – ')}
      </div>
      {!!value.window_title && <p>{text(value.window_title)}</p>}
      {!!timeline.length && (
        <section className="perception-details">
          <h4>采集时间线</h4>
          {status === 'pending' && <small role="status">正在识别截图 · {visual.length}/{total}</small>}
          {status === 'retrying' && <small role="status">部分截图等待重试 · 已识别 {visual.length}/{total}</small>}
          {status === 'awaiting_model' && <small role="status">截图已保存，等待配置视觉模型</small>}
          <ol>
            {timeline.map(({ kind, entry, file }, index) => (
              <li key={file?.id ?? kind + ':' + index}>
                <time dateTime={text(entry.occurred_at)}>
                  {time(entry.occurred_at)}
                </time>
                {kind === 'object' ? (
                  <span>切换到「{text(entry.window_title)}」</span>
                ) : <div>
                  {!!entry.window_title && (
                    <strong>{text(entry.window_title)}</strong>
                  )}
                  {!!entry.text && <p>{text(entry.text)}</p>}
                  {file && <Files files={[file]} />}
                </div>}
              </li>
            ))}
          </ol>
          {typeof value.work_objects_omitted === 'number' && (
            <small>另有 {value.work_objects_omitted} 次变化已省略</small>
          )}
        </section>
      )}
    </>
  )
}

function FormattedRecord({ item }: { item: HistoryItem }) {
  const payload = record(item.raw?.payload)
  const kind = text(payload.state_key)
  const value = record(payload.value)
  if (kind === 'desktop.window_span' && Object.keys(value).length) {
    return <DesktopSpan value={value} files={item.files} status={text(payload.image_recognition)}
      total={Array.isArray(payload.frames) ? payload.frames.length : item.files.length} />
  }
  return (
    <>
      {kind && <h3>{labels[kind] ?? kind}</h3>}
      {Object.keys(value).length ? (
        <dl className="perception-fields">
          {Object.entries(value).map(([key, field]) => (
            <div key={key}>
              <dt>{labels[key] ?? key}</dt>
              <dd>
                {typeof field === 'string'
                  ? field
                  : JSON.stringify(field, null, 2)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>
          {typeof payload.value === 'string'
            ? payload.value
            : (JSON.stringify(payload.value, null, 2) ?? item.text)}
        </p>
      )}
      <Files files={item.files} />
    </>
  )
}

export function PerceptionRecord({
  item,
  raw,
}: {
  item: HistoryItem
  raw: boolean
}) {
  let content
  if (!raw) content = <FormattedRecord item={item} />
  else if (item.raw)
    content = (
      <>
        <pre className="perception-json">
          {JSON.stringify(item.raw, null, 2)}
        </pre>
        <Files files={item.files} />
      </>
    )
  else content = <p>缺少原始事件数据</p>
  return (
    <article className="history-entry perception-entry">
      <header>
        <span>{text(item.raw?.terminal_id) || item.source}</span>
        <time dateTime={item.occurred_at ?? undefined}>
          {time(item.occurred_at) || '时间未记录'}
        </time>
      </header>
      {content}
    </article>
  )
}
