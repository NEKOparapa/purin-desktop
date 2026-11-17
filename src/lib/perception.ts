import type { HistoryItem, PerceptionStages } from './desktop'

const encoder = new TextEncoder()

export function byteLength(textValue: string) {
  return encoder.encode(textValue).length
}

export function approxTokens(bytes: number) {
  return bytes <= 0 ? 0 : Math.max(1, Math.round(bytes / 3))
}

export function formatBytes(bytes: number) {
  return `${bytes.toLocaleString('zh-CN')} 字节（约 ${approxTokens(bytes).toLocaleString('zh-CN')} tokens）`
}

export function formatBytesCompact(bytes: number) {
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB（${bytes.toLocaleString('zh-CN')} 字节，约 ${approxTokens(bytes).toLocaleString('zh-CN')} tokens）`
  }
  return formatBytes(bytes)
}

export function formatBytesShort(bytes: number) {
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes.toLocaleString('zh-CN')} 字节`
}

export interface DestinationBadge {
  key: 'filtered' | 'partial' | 'buffered' | 'summarized' | 'delivered' | 'acknowledged' | 'unprojected'
  icon: string
  label: string
  tone: 'muted' | 'warn' | 'info' | 'accent' | 'ok'
}

export function itemDestination(
  item: HistoryItem,
  stages?: PerceptionStages,
): DestinationBadge {
  const dest = item.destination
  const partial = item.filter_result === 'partial'
  if (stages) {
    const activeParts = stages.parts.filter((part) => part.text)
    if (!stages.parts.length && !dest) {
      return { key: 'unprojected', icon: '—', label: '未形成活动', tone: 'muted' }
    }
    if (stages.parts.length && !activeParts.length) {
      return { key: 'filtered', icon: '⛔', label: '已过滤', tone: 'muted' }
    }
    const deliveredPart = activeParts.find((part) => part.delivered)
    if (deliveredPart) {
      const form = deliveredPart.delivery?.form
      const suffix =
        form === 'summary' ? '（摘要形式）' : form === 'raw' ? '（原文形式）' : ''
      return {
        key: 'delivered',
        icon: '✅',
        label: '已进入上下文' + suffix,
        tone: 'ok',
      }
    }
    const roundId = activeParts.find((part) => part.round_id)?.round_id
    if (roundId) {
      return {
        key: 'summarized',
        icon: '🧠',
        label: `已并入摘要 R${roundId}`,
        tone: 'accent',
      }
    }
    if (partial) {
      return { key: 'partial', icon: '✂️', label: '部分过滤 · 缓冲中', tone: 'warn' }
    }
    if (activeParts.length) {
      return { key: 'buffered', icon: '⏳', label: '缓冲中', tone: 'info' }
    }
  }
  if (dest === 'filtered' || (!dest && item.filter_result === 'filtered')) {
    return { key: 'filtered', icon: '⛔', label: '已过滤', tone: 'muted' }
  }
  if (dest === 'delivered') {
    return { key: 'delivered', icon: '✅', label: '已进入上下文', tone: 'ok' }
  }
  if (dest === 'summarized') {
    return { key: 'summarized', icon: '🧠', label: '已并入摘要', tone: 'accent' }
  }
  if (dest === 'acknowledged') {
    return { key: 'acknowledged', icon: '✓', label: '已处理', tone: 'muted' }
  }
  if (dest === 'buffered') {
    return partial
      ? { key: 'partial', icon: '✂️', label: '部分过滤 · 缓冲中', tone: 'warn' }
      : { key: 'buffered', icon: '⏳', label: '缓冲中', tone: 'info' }
  }
  if (dest === 'unprojected' || (!dest && item.filter_result === 'unprojected')) {
    return { key: 'unprojected', icon: '—', label: '未进入流水线', tone: 'muted' }
  }
  if (partial) {
    return { key: 'partial', icon: '✂️', label: '部分过滤', tone: 'warn' }
  }
  return { key: 'buffered', icon: '⏳', label: '已保留', tone: 'info' }
}

export const labels: Record<string, string> = {
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

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const rest = Number((seconds % 60).toFixed(3))
  return [
    hours && hours + ' 小时',
    minutes && minutes + ' 分钟',
    (rest || !seconds) && rest + ' 秒',
  ]
    .filter(Boolean)
    .join(' ')
}

export function perceptionLabel(item: HistoryItem) {
  const payload = record(item.raw?.payload)
  const value = record(payload.value)
  const key = text(payload.state_key)
  return {
    title:
      text(value.foreground_app) ||
      labels[key] ||
      key ||
      text(item.raw?.type) ||
      '设备观测',
    subject: text(value.window_title) || text(value.title),
    source: text(item.raw?.terminal_id) || item.source,
    duration:
      typeof value.duration_seconds === 'number'
        ? duration(value.duration_seconds)
        : '',
  }
}
