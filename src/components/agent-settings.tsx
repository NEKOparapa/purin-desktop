import { useState } from 'react'
import { Activity, Cable, Palette, Plug } from 'lucide-react'
import {
  readBrowserAppearance,
  setBrowserAppearance,
  type AgentState,
  type Appearance,
} from '@/lib/desktop'
import { Button } from '@/components/ui/button'
import { ConnectorSettings } from '@/components/connector-settings'
import { DialogTitle } from '@/components/ui/dialog'

const sections = [
  { id: 'connection', label: '连接', icon: Cable },
  { id: 'connectors', label: '连接器', icon: Plug },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'collection', label: '信息采集', icon: Activity },
] as const
type Section = (typeof sections)[number]['id']

const devicePlatformLabels = { windows: 'Windows', macos: 'macOS' }

export function AgentSettings({
  state,
  onConnected,
}: {
  state: AgentState
  onConnected: () => void
}) {
  const [browserMode, setBrowserMode] = useState(readBrowserAppearance)
  const [appearanceError, setAppearanceError] = useState('')
  const [url, setUrl] = useState(state.url)
  const [deviceId, setDeviceId] = useState(state.deviceId)
  const [deviceName, setDeviceName] = useState(state.deviceName)
  const [token, setToken] = useState('')
  const [pairValue, setPairValue] = useState('')
  const [manual, setManual] = useState(false)
  const [editing, setEditing] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Section>('connection')
  const [sourceFeedback, setSourceFeedback] = useState<{
    section: Section
    message: string
  }>()
  const api = window.wintermute
  const connectionState = state.issue ? 'error' : state.configured ? 'connected' : 'disconnected'
  const connectionStatus = { error: '连接异常', connected: '已连接', disconnected: '未连接' }
  const showConnection = state.configured && !editing
  const failedMaterial = state.failedMaterial

  function editConnection() {
    setUrl(state.url)
    setDeviceId(state.deviceId)
    setDeviceName(state.deviceName)
    setToken('')
    setPairValue('')
    setManual(false)
    setFeedback('')
    setEditing(true)
  }
  async function change(action: () => Promise<void> | undefined) {
    if (busy) return
    setBusy(true)
    setSourceFeedback(undefined)
    try {
      await action()
    } catch (error) {
      setSourceFeedback({
        section: tab,
        message:
          error instanceof Error
            ? error.message.replace(/^.*?Error: /, '')
            : '操作未完成，请重试',
      })
    } finally {
      setBusy(false)
    }
  }
  const appearance = api ? state.appearance : browserMode
  async function chooseAppearance(mode: Appearance) {
    try {
      if (api) await api.setAppearance(mode)
      else {
        setBrowserAppearance(mode)
        setBrowserMode(mode)
      }
      setAppearanceError('')
    } catch {
      setAppearanceError('外观设置未保存，请重试。')
    }
  }

  async function save() {
    if (!api || busy) return
    setBusy(true)
    setFeedback('')
    try {
      if (manual) await api.configure({ url, deviceId, token, deviceName })
      else await api.pair({ value: pairValue, serverUrl: url })
      onConnected()
      setToken('')
      setPairValue('')
      setEditing(false)
      setFeedback('连接已保存')
    } catch (error) {
      setFeedback(
        '连接失败 · ' +
          (error instanceof Error
            ? error.message.replace(/^.*?Error: /, '')
            : '请检查服务地址和连接凭据'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="settings-sidebar">
        <DialogTitle>设备设置</DialogTitle>
        <nav className="nav-list" aria-label="设置分类">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className="nav-item"
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              aria-label={label}
              title={label}
              onClick={() => setTab(id)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
      <section
        key={tab}
        className="settings-panel"
        aria-labelledby="settings-section-title"
      >
        <h3 id="settings-section-title">
          {sections.find(({ id }) => id === tab)?.label}
        </h3>
        {tab === 'connectors' && (
          <ConnectorSettings
            key={JSON.stringify([
              state.url,
              state.deviceId,
              state.connectionRevision,
              state.configured,
            ])}
            configured={state.configured}
            revision={state.connectionRevision}
            remoteCommandsEnabled={state.remoteCommandsEnabled}
            macConnectors={state.macConnectors}
            remoteTools={state.remoteTools}
            remoteIssue={state.remoteIssue}
          />
        )}
        {tab === 'appearance' && (
          <fieldset className="appearance-settings">
            <legend>主题</legend>
            <div>
              {(
                [
                  ['system', '跟随系统'],
                  ['light', '浅色'],
                  ['dark', '深色'],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="appearance"
                    checked={appearance === value}
                    onChange={() => void chooseAppearance(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            {appearanceError && (
              <p className="issue" role="status">
                {appearanceError}
              </p>
            )}
          </fieldset>
        )}
        {tab === 'connection' && (
          <section className="connection-card" aria-labelledby="device-connection-title">
            <header className="connection-card-header">
              <div className="connection-card-heading">
                <h4 id="device-connection-title">设备连接</h4>
                <span className="connection-status" data-state={connectionState}>
                  {connectionStatus[connectionState]}
                </span>
              </div>
              {showConnection && (
                <Button type="button" size="sm" variant="outline" onClick={editConnection}>
                  编辑连接
                </Button>
              )}
            </header>
            <dl className="connection-details">
              {showConnection && (
                <div>
                  <dt>设备名称</dt>
                  <dd>{state.deviceName}</dd>
                </div>
              )}
              <div>
                <dt>设备平台</dt>
                <dd>
                  {state.devicePlatform ? devicePlatformLabels[state.devicePlatform] : '未知'}
                </dd>
              </div>
              {showConnection && (
                <>
                  <div>
                    <dt>服务地址</dt>
                    <dd>{state.url}</dd>
                  </div>
                  <div>
                    <dt>设备 ID</dt>
                    <dd>{state.deviceId}</dd>
                  </div>
                </>
              )}
            </dl>
            {state.issue && (
              <p className="issue" role="status">
                {state.issue}
              </p>
            )}
            {!showConnection && !manual && (
              <form
                className="connection-form connection-editor"
                onSubmit={(event) => {
                  event.preventDefault()
                  void save()
                }}
              >
                <label className="connection-full-width">
                  配对码或链接
                  <input
                    value={pairValue}
                    onChange={(event) => setPairValue(event.target.value)}
                    placeholder="从后端管理面板复制"
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                </label>
                {!pairValue.trim().startsWith('https://') && (
                  <label className="connection-full-width">
                    服务地址
                    <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} />
                  </label>
                )}
                <div className="connection-actions connection-full-width">
                  <Button type="submit" disabled={!api || busy}>
                    {busy ? '正在配对…' : '配对并连接'}
                  </Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => setManual(true)}>
                    手动配置
                  </Button>
                  {editing && (
                    <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                      取消
                    </Button>
                  )}
                </div>
              </form>
            )}
            {!showConnection && manual && (
              <form
                className="connection-form connection-editor"
                onSubmit={(e) => {
                  e.preventDefault()
                  void save()
                }}
              >
                <p className="settings-note connection-full-width">
                  {api
                    ? '将本机设备 ID 登记到后端，然后填写对应令牌。'
                    : '请打开 Wintermute 桌面应用以连接服务。'}
                </p>
                <label className="connection-full-width">
                  服务地址
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                  />
                </label>
                <label>
                  设备名称
                  <input
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    maxLength={80}
                    required
                  />
                </label>
                <label>
                  设备 ID
                  <input
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                    required
                  />
                </label>
                <label className="connection-full-width">
                  设备令牌
                  <input
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={
                      state.configured &&
                      state.url === url.trim() &&
                      state.deviceId === deviceId.trim()
                        ? '留空以使用当前连接令牌'
                        : 'Bearer token'
                    }
                  />
                </label>
                <div className="connection-actions connection-full-width">
                  <Button type="submit" disabled={!api || busy}>
                    {busy ? '正在验证…' : '验证并保存'}
                  </Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => setManual(false)}>
                    使用配对码
                  </Button>
                  {editing && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setToken('')
                        setFeedback('')
                        setEditing(false)
                      }}
                    >
                      取消
                    </Button>
                  )}
                </div>
              </form>
            )}
            {feedback && (
              <p className="settings-note" role="status">
                {feedback}
              </p>
            )}
          </section>
        )}
        {tab === 'collection' && (
          <>
            <div className="activity-settings">
              <label>
                <input
                  type="checkbox"
                  aria-describedby="desktop-activity-description"
                  checked={state.collecting}
                  disabled={!api || !state.configured || busy}
                  onChange={(e) => {
                    const enabled = e.target.checked
                    void change(() => api?.setCollection(enabled))
                  }}
                />{' '}
                采集桌面活动
              </label>
              <p id="desktop-activity-description">
                约每秒采样一次，未操作键鼠也会累计前台停留。切走或锁屏后上传本次停留及窗口标题变化，包括短停留。在后端管理面板的「历史记录 → 感知层」可查看原始记录和后端的过滤原因。
              </p>
              {state.collecting && navigator.platform.startsWith('Mac') && (
                <p>
                  macOS 读取窗口标题可能需要在系统设置中允许辅助功能和自动化。
                </p>
              )}
              {state.lastSpan && (
                <p>
                  最近一次停留 ·{' '}
                  {new Date(state.lastSpan.ended_at).toLocaleString('zh-CN')}
                  {' · '}
                  {state.lastSpan.foreground_app} · 约{' '}
                  {state.lastSpan.duration_seconds} 秒
                  {state.lastSpan.window_title &&
                    ' · ' + state.lastSpan.window_title}
                </p>
              )}
              {state.sampleIssue && (
                <p role="status">桌面采样待重试 · {state.sampleIssue}</p>
              )}
            </div>
            <div className="activity-settings">
              <label>
                <input
                  type="checkbox"
                  aria-describedby="screenshot-description"
                  checked={!!state.screenshotsEnabled}
                  disabled={
                    !api || !state.configured || !state.collecting || busy
                  }
                  onChange={(e) => {
                    const enabled = e.target.checked
                    void change(() => api?.setScreenshots({ enabled }))
                  }}
                />
                自动截图（前台窗口）
              </label>
              <p id="screenshot-description">
                同一应用连续在前台停留满 10
                分钟时截一张，切换标签页或窗口标题不会重新计时。离开应用后随停留记录上传，可在后端管理面板的「历史记录 → 感知层 → 原始信息」查看。
              </p>
              {state.screenshotIssue && (
                <p role="status">{state.screenshotIssue}</p>
              )}
            </div>
            {(state.pendingMaterials > 0 || state.materialIssue) && (
              <dl className="settings-facts" aria-label="材料传送状态">
                <div>
                  <dt>等待上传</dt>
                  <dd>
                    {state.pendingMaterials} 项 {state.materialIssue}
                    {failedMaterial && (
                      <div className="setting-actions">
                        <button
                          type="button"
                          disabled={!api || busy}
                          onClick={() =>
                            void change(() =>
                              api?.manageFailed(failedMaterial, true),
                            )
                          }
                        >
                          重试此项
                        </button>
                        <button
                          type="button"
                          disabled={!api || busy}
                          onClick={() =>
                            void change(() =>
                              api?.manageFailed(failedMaterial, false),
                            )
                          }
                        >
                          丢弃此项
                        </button>
                      </div>
                    )}
                  </dd>
                </div>
              </dl>
            )}
          </>
        )}
        {sourceFeedback?.section === tab && (
          <p className="source-feedback" role="status">
            {sourceFeedback.message}
          </p>
        )}
      </section>
    </>
  )
}
