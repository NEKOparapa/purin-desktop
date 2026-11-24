import { useEffect, useState } from 'react'
import type { PetRect } from './pet-layout'

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

export interface DeviceFile { id: string; name: string; size_bytes: number; content_type: string }
export interface DeviceNotice {
  id: string; title: string; body: string; created_at: string | null; expires_at: string | null;
  notify_at: string; targets: string[]; target_names: string[]; in_inbox: boolean;
  status: 'scheduled' | 'sent' | 'partial' | 'failed';
  received_at: string | null; read_at: string | null; expired: boolean; attachments: DeviceFile[]
}
export interface NoticeAlert { id: string; title: string; body: string; open: boolean; deviceId: string; url: string; notifyAt: string }
export interface ChatFileRef {
  id: string
  name: string
}

export interface ChatAttachments {
  images: string[]
  documents: ChatFileRef[]
  imageNames: string[]
}
export type UploadChatFile = (name: string, data: ArrayBuffer, revision: number) => Promise<ChatFileRef>

export interface HistoryFile extends ChatFileRef {
  content_type?: string
  occurred_at?: string
  window_title?: string
}
export interface ResultsPage<T> {
  items: T[]
  next_cursor: string | null
}
export interface ScheduleEntry {
  id: string
  title: string
  content: string | null
  trigger_at: string
  action: 'notify_agent' | 'notify_device'
  notification?: DeviceNotice
  status: 'scheduled' | 'triggered'
}

export interface ScheduleRange {
  start: string
  end: string
  cursor?: string
}

export interface PendingQuestion {
  id: string
  title: string
  question: string
  options: string[]
  multi_select: boolean
  allow_custom: boolean
  status: 'pending' | 'answered' | 'dismissed'
  created_at: string
}
export interface ChatMessage {
  documents?: ChatFileRef[]
  images?: string[]
  files?: HistoryFile[]
  id: string
  role: 'user' | 'assistant'
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
  hasUnreadNotifications: boolean
  deviceName: string
  devicePlatform: 'windows' | 'macos' | null
  appearance: Appearance
  url: string
  deviceId: string
  configured: boolean
  connectionRevision?: number
  collecting: boolean
  remoteCommandsEnabled: boolean
  remoteTools: string[]
  remoteIssue: string
  obsidianEnabled?: boolean
  macConnectors?: MacConnectorState[]
  obsidianVaultPath?: string
  screenshotsEnabled: boolean
  screenshotIssue: string
  textInputEnabled: boolean
  textInputIssue: string
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
    input_segments?: {
      occurred_at: string
      ended_at?: string
      text: string
      window_title?: string
    }[]
  } | null
  hasEarlier: boolean
  awaitingReply: boolean
  replyReceivedAt: number
  messages: ChatMessage[]
  questions: PendingQuestion[]
}
export interface Connection {
  deviceName?: string
  url: string
  deviceId: string
  token: string
}
export interface DetectedObsidianVault {
  id: string
  name: string
  path: string
  open: boolean
}
export interface MacConnectorState {
  id: string
  name: string
  description: string
  enabled: boolean
}
export interface ObsidianConnectorState {
  enabled: boolean
  vaultPath: string
  vaultName: string
  noteCount: number
  hasObsidianDir: boolean
  valid: boolean
  detectedVaults: DetectedObsidianVault[]
}
export interface ConnectorSourceInfo {
  kind: 'official' | 'third_party'
  found_at: string
  publisher: string
}
export interface ConnectorConnectionInfo {
  connection_id: string
  label: string
  verified: boolean
}
export interface ConnectorItem {
  id: string
  name: string
  tool_type: 'mcp' | 'device' | 'cli'
  connected: boolean
  status: string
  endpoint: string | null
  source: ConnectorSourceInfo | null
  header_names: string[]
  credential_label: string | null
  credential_query_param: string | null
  auth_mode: 'none' | 'credential' | 'oauth' | 'device'
  device_id: string | null
  config: Record<string, unknown>
  verified: boolean
  enabled: boolean
  has_credentials: boolean
  connections: ConnectorConnectionInfo[]
}
export interface ConnectorsSnapshot {
  items: ConnectorItem[]
  obsidian: ObsidianConnectorState
}
export interface AddMcpConnectorInput {
  name: string
  endpoint: string
  source: ConnectorSourceInfo
  header_names?: string[]
  credential_label?: string | null
  credential_query_param?: string | null
  credentials?: Record<string, string> | null
}
export interface ConnectorMutationResult {
  item: ConnectorItem
  tool_count: number | null
  verify_error: string | null
}
export interface PetSnapshot {
  session: number
  workArea: PetRect
  anchor: { x: number; y: number }
  preferredSide: 'left' | 'right'
  appearance: Appearance
  configured: boolean
  connectionRevision: number
  reply: { id: string; text: string } | null
  awaitingReply: boolean
  replyReceivedAt: number
  waiting: boolean
  issue: string
}
export interface PetBridge {
  state(): Promise<PetSnapshot>
  transcribe(audio: ArrayBuffer, connectionRevision: number): Promise<string>
  uploadChatFile: UploadChatFile
  send(text: string, revision: number, attachments?: ChatAttachments): Promise<void>
  setRegion(bounds: PetRect, shape: PetRect[], session: number): Promise<void>
  move(x: number, y: number, session: number): Promise<void>
  drop(session: number): Promise<void>
  restore(settings?: boolean): Promise<void>
  subscribe(
    callback: (state: PetSnapshot) => void,
    onPosition: (position: Pick<PetSnapshot, 'session' | 'anchor' | 'workArea'>) => void,
  ): () => void
}
declare global {
  interface Window {
    wintermutePet?: PetBridge
    wintermute?: {
      initialAppearance: Appearance
      enterPetMode(): Promise<void>
      onPetSettings(callback: () => void): () => void
      state(): Promise<AgentState>
      configure(settings: Connection): Promise<void>
      pair(options: { value: string }): Promise<void>
      connectors(): Promise<ConnectorsSnapshot>
      setMacConnector?(options: {
        id: string
        enabled: boolean
        connectionRevision: number
      }): Promise<void>
      chooseObsidianVault(): Promise<string | null>
      setObsidianConnector(options: {
        enabled: boolean
        vaultPath?: string
        connectionRevision?: number
      }): Promise<ObsidianConnectorState>
      addMcpConnector(payload: AddMcpConnectorInput): Promise<ConnectorMutationResult>
      saveConnectorCredentials(payload: {
        id: string
        values: Record<string, string>
        connectionId?: string
        connectionLabel?: string
      }): Promise<ConnectorMutationResult>
      testConnector(id: string): Promise<ConnectorMutationResult>
      deleteConnector(id: string): Promise<{ deleted: boolean; id: string }>
      schedule(range: ScheduleRange): Promise<ResultsPage<ScheduleEntry>>
      notificationPage(cursor?: string): Promise<ResultsPage<DeviceNotice>>
      readNotification(id: string): Promise<unknown>
      answerQuestion(payload: {
        id: string
        selectedOptions: string[]
        answerText: string
      }): Promise<PendingQuestion>
      dismissQuestion(id: string): Promise<PendingQuestion>
      downloadNotificationFile(file: {notificationId: string; file: DeviceFile}): Promise<{saved: boolean}>
      onNotice(callback: (alert: NoticeAlert) => void): () => void
      downloadHistoryFile(file: HistoryFile): Promise<{ saved: boolean }>
      previewHistoryImage(options: { id: string; connectionRevision: number }): Promise<ArrayBuffer>
      loadEarlier(): Promise<void>
      uploadChatFile: UploadChatFile
      send(text: string, images?: string[], documents?: ChatFileRef[], imageNames?: string[], revision?: number): Promise<void>
      transcribe(audio: ArrayBuffer, connectionRevision: number): Promise<string>
      retry(id: string): Promise<void>
      setCollection(enabled: boolean): Promise<void>
      setRemoteCommands(options: { enabled: boolean; connectionRevision?: number }): Promise<void>
      setScreenshots(options: {
        enabled: boolean
      }): Promise<void>
      setTextInput(options: {
        enabled: boolean
      }): Promise<void>
      manageFailed(id: string, retry: boolean): Promise<void>
      setAppearance(mode: Appearance): Promise<void>
      subscribe(callback: (state: AgentState) => void): () => void
    }
  }
}
const initial: AgentState = {
  hasUnreadNotifications: false,
  deviceName: '',
  devicePlatform: null,
  appearance: 'system',
  url: 'http://127.0.0.1:8080',
  deviceId: 'http-desktop',
  configured: false,
  collecting: false,
  remoteCommandsEnabled: false,
  remoteTools: [],
  remoteIssue: '',
  screenshotsEnabled: false,
  screenshotIssue: '',
  textInputEnabled: false,
  textInputIssue: '',
  pendingMaterials: 0,
  failedMaterial: null,
  materialIssue: '',
  lastMaterial: null,
  issue: '',
  sampleIssue: '',
  hasEarlier: false,
  awaitingReply: false,
  replyReceivedAt: 0,
  messages: [],
  questions: [],
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
