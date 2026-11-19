import { useEffect, useState } from 'react'

export type Appearance = 'system' | 'light' | 'dark'
const browserAppearanceKey = 'wintermute.appearance'

export function readBrowserAppearance(): Appearance {
  try {
    const value = localStorage.getItem(browserAppearanceKey)
    if (value === 'light' || value === 'dark') return value
  } catch {
    // The browser might restrict storage in a private or embedded preview.
  }
  return 'system'
}

export function setBrowserAppearance(mode: Appearance) {
  localStorage.setItem(browserAppearanceKey, mode)
  document.documentElement.dataset.appearance = mode
}

export type HistoryView =
  'conversation' | 'notification' | 'perception' | 'slice' | 'chat' | 'timeline'

export interface MemoryFile {
  path: string
  bytes: number
  updated_at: string
  title?: string
  summary?: string
}
export interface MemoryDocument {
  path: string
  content: string
  content_sha256: string
}
export type RecordType = 'sms' | 'call_log' | 'contacts' | 'notion' | 'recording_list' | 'document'
export interface ImportedRecord {
  id: string
  record_type: RecordType
  source_name: string
  batch_id: string
  occurred_at: string
  received_at: string
  title: string | null
  external_id: string | null
  status: 'pending' | 'filtered' | 'processing' | 'processed' | 'failed'
  attempts: number
  error: string | null
}
export interface RecordContent {
  text: string
  format: 'text' | 'json'
  offset: number
  next_offset: number | null
  total_chars: number
}

export interface DeviceFile { id: string; name: string; size_bytes: number; content_type: string }
export interface DeviceNotice {
  id: string; title: string; body: string; created_at: string; expires_at: string | null;
  received_at: string | null; read_at: string | null; expired: boolean; attachments: DeviceFile[]
}
export interface NoticeAlert { id: string; title: string; body: string; open: boolean; terminal: string; url: string }
export interface HistoryFile {
  id: string
  name: string
  content_type?: string
  occurred_at?: string
  window_title?: string
}
export interface ScreenshotGroup {
  id: string
  app: string
  subject: string
  started_at: string
  ended_at: string
  frame_count: number
  change_count: number
}
export interface HistoryItem {
  id: string
  occurred_at: string | null
  role: string
  source: string
  text: string
  files: HistoryFile[]
  raw?: Record<string, unknown>
  filter_result?: 'filtered' | 'partial' | 'kept' | 'unprojected'
  context_messages?: ContextMessageRef[]
  pending_context?: boolean
  layer?: ActivityLayer | 'conversation' | 'notification'
  material_type?: 'slice.recorded' | 'slice.audio' | 'slice.image'
  processing?: 'ready' | 'retrying' | 'pending'
  members?: { id: string; occurred_at: string; terminal: string; layer: ActivityLayer }[]
  merged_summary?: {
    kind: 'ai' | 'rules'
    generated_at: string | null
    covered_from: string
    covered_until: string
  }
  context_write?: { covered_from: string | null; covered_until: string | null }
  summary_round?: SummaryRoundRef
  usage?: TimelineUsage
  group?: ScreenshotGroup | null
}
export interface HistoryPage {
  items: HistoryItem[]
  next_cursor: string | null
}

export interface TerminalToolCall {
  id: string
  terminal_id: string
  tool: string
  arguments: Record<string, unknown>
  timeout_seconds: number
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'expired'
  created_at: string
  started_at: string | null
  completed_at: string | null
  stdout: string
  stderr: string
  exit_code: number | null
  truncated: boolean
}

export type ActivityLayer = 'perception' | 'slice'
export type CompressionStatus =
  'open' | 'rules' | 'pending' | 'ready' | 'retrying' | 'disabled'
export interface CompressionBatch {
  id: string
  terminal_id: string
  started_at: string
  ended_at: string
  perception_count: number
  slice_count: number
  status: CompressionStatus
  partial: boolean
}
export interface CompressionTexts {
  rule_text: string | null
  ai_text: string | null
}
export interface ResultsPage<T> {
  items: T[]
  next_cursor: string | null
}
export interface BatchObservation {
  id: string
  layer: ActivityLayer
  occurred_at: string
  source: string
  text: string
  source_count: number
}
export interface CompressionDetail
  extends ResultsPage<BatchObservation>, CompressionTexts {
  batch: CompressionBatch
  rollup: (CompressionTexts & { status: CompressionStatus }) | null
}
export interface OriginalRecord {
  id: string
  kind: string
  occurred_at: string
  source: string
  payload: Record<string, unknown>
  transcript: string | null
  files: HistoryFile[]
}
export interface OriginalDetail extends ResultsPage<OriginalRecord> {
  extraction: {
    status: 'ready' | 'no_change' | 'pending' | 'retrying' | 'not_recorded'
    text: string | null
    strategy: string | null
    source_count: number
  }
}

export interface PerceptionStages {
  record?: HistoryItem
  context_messages?: ContextMessageRef[]
  dwell_threshold_seconds?: number
  filter_reason?: 'wintermute_app' | 'short_dwell' | null
  decisions: { kind: 'application' | 'title'; label: string; seconds: number; kept: boolean }[]
  retained: unknown
  parts: { kind: 'observation' | 'visual'; text: string; tokens?: number; delivered: boolean; round_id: string | null }[]
  rounds: { id: string; status: 'pending' | 'ready' | 'retrying' | 'disabled'; input: string; summary: string | null; timeline_entry?: SummaryRoundRef | null }[]
  ai_enabled: boolean
  budget: number
  pending_size: number
}

export interface TimelineUsage {
  tokens: number
  tokenizer?: 'deepseek-v4'
  budget: number
  devices: string[]
  duration_seconds: number | null
}

export interface ContextMessageRef {
  id: string
  written_at: string | null
  activity_at?: string | null
  parts?: ('observation' | 'visual')[]
  usage?: TimelineUsage
}
export interface SummaryRoundRef {
  id: string
  occurred_at: string
  generated_at: string | null
  usage?: TimelineUsage
}
export interface TraceMember {
  id: string
  event_id: string | null
  title: string
  terminal: string
  occurred_at: string
  usage?: TimelineUsage
}
export interface TracePage extends ResultsPage<TraceMember> {
  round?: {
    input: string
    summary: string | null
    archived_text_only?: boolean
    previous_summary?: SummaryRoundRef | null
  }
  text: string | null
  written_at: string | null
}

export interface ScheduleEntry {
  id: string
  title: string
  content: string | null
  trigger_at: string
  action: 'notify_agent'
  status: 'scheduled' | 'triggered'
}

export interface ScheduleRange {
  start: string
  end: string
  cursor?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  notificationReply?: boolean
  text: string
  at: string | null
  status?:
    | 'queued'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'interrupted'
    | 'unsent'
    | 'missing'
  error?: string
}
export interface AgentState {
  appearance: Appearance
  url: string
  terminal: string
  configured: boolean
  connectionRevision?: number
  collecting: boolean
  remoteCommandsEnabled: boolean
  remoteTools: string[]
  remoteIssue: string
  screenshotsEnabled: boolean
  screenshotIssue: string
  pendingMaterials: number
  failedMaterial: string | null
  materialIssue: string
  lastMaterial: { label: string; at: string } | null
  issue: string
  sampleIssue: string
  lastSpan: {
    ended_at: string
    duration_seconds: number
    foreground_app: string
    window_title?: string
  } | null
  hasEarlier: boolean
  messages: ChatMessage[]
}
export interface Connection {
  url: string
  terminal: string
  token: string
}
export interface ApiKeySetting {
  id: string
  usages: string[]
  configured: boolean
  masked: string | null
}
export interface ApiKeyUpdate {
  id: string
  apiKey: string
  connectionRevision: number
}
declare global {
  interface Window {
    wintermute?: {
      initialAppearance: Appearance
      state(): Promise<AgentState>
      configure(settings: Connection): Promise<void>
      apiKeys(): Promise<ApiKeySetting[]>
      updateApiKey(update: ApiKeyUpdate): Promise<ApiKeySetting[]>
      schedule(range: ScheduleRange): Promise<ResultsPage<ScheduleEntry>>
      memoryTree(): Promise<MemoryFile[]>
      memoryFile(path: string): Promise<MemoryDocument>
      recordItems(options?: { cursor?: string; recordType?: RecordType }): Promise<ResultsPage<ImportedRecord>>
      recordContent(options: { id: string; offset?: number }): Promise<RecordContent>
      terminalToolHistory(cursor?: string): Promise<ResultsPage<TerminalToolCall>>
      history(options: {
        view: HistoryView
        cursor?: string
        groupId?: string
      }): Promise<HistoryPage>
      compression(options: { kind: 'stages'; id: string; record?: boolean }): Promise<PerceptionStages>
      compression(options: { kind: 'trace'; id: string; cursor?: string }): Promise<TracePage>
      compression(options: {
        kind: 'list'
        layer: ActivityLayer
        cursor?: string
      }): Promise<ResultsPage<CompressionBatch>>
      compression(options: {
        kind: 'batch'
        id: string
        cursor?: string
      }): Promise<CompressionDetail>
      compression(options: {
        kind: 'source'
        id: string
        activity?: boolean
        cursor?: string
      }): Promise<OriginalDetail>
      notificationPage(cursor?: string): Promise<ResultsPage<DeviceNotice>>
      readNotification(id: string): Promise<unknown>
      downloadNotificationFile(file: {notificationId: string; file: DeviceFile}): Promise<{saved: boolean}>
      onNotice(callback: (alert: NoticeAlert) => void): () => void
      downloadHistoryFile(file: HistoryFile): Promise<{ saved: boolean }>
      previewHistoryImage(options: { id: string; connectionRevision: number }): Promise<ArrayBuffer>
      loadEarlier(): Promise<void>
      send(text: string): Promise<void>
      retry(id: string): Promise<void>
      setCollection(enabled: boolean): Promise<void>
      setRemoteCommands(options: { enabled: boolean; connectionRevision?: number }): Promise<void>
      setScreenshots(options: {
        enabled: boolean
      }): Promise<void>
      manageFailed(id: string, retry: boolean): Promise<void>
      setAppearance(mode: Appearance): Promise<void>
      subscribe(callback: (state: AgentState) => void): () => void
    }
  }
}
const initial: AgentState = {
  appearance: 'system',
  url: 'http://127.0.0.1:8080',
  terminal: 'http-desktop',
  configured: false,
  collecting: false,
  remoteCommandsEnabled: false,
  remoteTools: [],
  remoteIssue: '',
  screenshotsEnabled: false,
  screenshotIssue: '',
  pendingMaterials: 0,
  failedMaterial: null,
  materialIssue: '',
  lastMaterial: null,
  issue: '',
  sampleIssue: '',
  hasEarlier: false,
  messages: [],
  lastSpan: null,
}

export function useAgent() {
  const [state, setState] = useState(initial)
  useEffect(() => {
    const api = window.wintermute
    if (!api) return
    let live = true,
      received = false
    function applyState(next: AgentState) {
      document.documentElement.dataset.appearance = next.appearance
      setState(next)
    }
    const unsubscribe = api.subscribe((next) => {
      received = true
      applyState(next)
    })
    api
      .state()
      .then((next) => {
        if (live && !received) applyState(next)
      })
      .catch(() => {
        if (live) setState((s) => ({ ...s, issue: '无法读取桌面端连接状态' }))
      })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])
  return state
}
