import { useState } from 'react'
import {
  Activity,
  Cable,
  Check,
  Eye,
  EyeOff,
  Monitor,
  Moon,
  Palette,
  Plug,
  Sun,
} from 'lucide-react'
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
  { id: 'connection', label: '设备配对', icon: Cable },
  { id: 'connectors', label: '连接器', icon: Plug },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'collection', label: '信息采集', icon: Activity },
] as const
type Section = (typeof sections)[number]['id']

const devicePlatformLabels = { windows: 'Windows', macos: 'macOS' }
const appearanceOptions = [
  {
    value: 'system',
    label: '跟随系统',
    description: '跟随操作系统的明暗外观设置自动切换。',
    icon: Monitor,
  },
  {
    value: 'light',
    label: '浅色',
    description: '始终使用明亮通透的云雾浅色背景与毛玻璃卡片表面。',
    icon: Sun,
  },
  {
    value: 'dark',
    label: '深色',
    description: '始终使用柔和低眩光的夜空深色背景与深色卡片表面。',
    icon: Moon,
  },
] as const

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
  const [showToken, setShowToken] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [feedbackError, setFeedbackError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Section>('connection')
  const [sourceFeedback, setSourceFeedback] = useState<{
    section: Section
    message: string
  }>()
  const api = window.purin
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
    setShowToken(false)
    setManual(state.configured)
    setFeedback('')
    setFeedbackError(false)
    setEditing(true)
  }
  function cancelEdit() {
    setToken('')
    setShowToken(false)
    setFeedback('')
    setFeedbackError(false)
    setEditing(false)
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

  async function save(value = pairValue) {
    if (!api || busy) return
    setBusy(true)
    setFeedback('')
    setFeedbackError(false)
    try {
      if (manual) await api.configure({ url, deviceId, token, deviceName })
      else await api.pair({ value })
      onConnected()
      setToken('')
      setShowToken(false)
      setPairValue('')
      setEditing(false)
      setFeedback('连接已验证并保存')
    } catch (error) {
      setFeedbackError(true)
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
          <section
            className="connection-card appearance-card"
            aria-labelledby="appearance-theme-title"
          >
            <header className="connection-card-header">
              <div className="connection-card-heading">
                <h4 id="appearance-theme-title">界面主题</h4>
              </div>
            </header>
            <fieldset className="appearance-settings" aria-labelledby="appearance-theme-title">
              <div className="theme-grid">
                {appearanceOptions.map(({ value, label, icon: Icon }) => {
                  const selected = appearance === value
                  return (
                    <label
                      key={value}
                      className="theme-option"
                      data-selected={selected}
                    >
                      <input
                        type="radio"
                        name="appearance"
                        checked={selected}
                        onChange={() => void chooseAppearance(value)}
                      />
                      <span
                        className="theme-preview"
                        data-mode={value}
                        aria-hidden="true"
                      >
                        <span
                          className={`theme-preview-pane ${value === 'dark' ? 'dark' : 'light'}`}
                        >
                          <i className="preview-pill" />
                          <i className="preview-msg assistant" />
                          <i className="preview-msg user" />
                          <i className="preview-bar" />
                        </span>
                        {value === 'system' && (
                          <span className="theme-preview-pane dark split">
                            <i className="preview-pill" />
                            <i className="preview-msg assistant" />
                            <i className="preview-msg user" />
                            <i className="preview-bar" />
                          </span>
                        )}
                      </span>
                      <span className="theme-option-footer">
                        <span className="theme-option-label">
                          <Icon size={15} aria-hidden="true" />
                          {label}
                        </span>
                        <span className="theme-option-check" aria-hidden="true">
                          {selected && <Check size={11} strokeWidth={2.8} />}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
            <p className="settings-note">
              {appearanceOptions.find((item) => item.value === appearance)?.description}
              外观偏好仅保存在当前设备上，主窗口与桌宠气泡会立即同步。
            </p>
            {appearanceError && (
              <p className="issue" role="status">
                {appearanceError}
              </p>
            )}
          </section>
        )}
        {tab === 'connection' && (
          <section className="connection-card" aria-labelledby="device-connection-title">
            <header className="connection-card-header">
              <div className="connection-card-heading">
                <h4 id="device-connection-title">
                  {showConnection
                    ? '当前连接'
                    : editing
                      ? '编辑连接'
                      : '连接后端服务'}
                </h4>
                {showConnection ? (
                  <span className="connection-status" data-state={connectionState}>
                    {connectionStatus[connectionState]}
                  </span>
                ) : (
                  state.devicePlatform && (
                    <span className="connection-platform-tag">
                      {devicePlatformLabels[state.devicePlatform]}
                    </span>
                  )
                )}
              </div>
              {showConnection && (
                <Button type="button" size="sm" variant="outline" onClick={editConnection}>
                  编辑连接
                </Button>
              )}
              {!showConnection && editing && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={cancelEdit}
                >
                  取消
                </Button>
              )}
            </header>
            {showConnection && (
              <>
                <dl className="connection-details">
                  <div className="connection-detail-item">
                    <dt>设备名称</dt>
                    <dd>{state.deviceName}</dd>
                  </div>
                  <div className="connection-detail-item">
                    <dt>设备平台</dt>
                    <dd>
                      {state.devicePlatform
                        ? devicePlatformLabels[state.devicePlatform]
                        : '未知'}
                    </dd>
                  </div>
                  <div className="connection-detail-item">
                    <dt>服务地址</dt>
                    <dd className="mono-value">{state.url}</dd>
                  </div>
                  <div className="connection-detail-item">
                    <dt>设备 ID</dt>
                    <dd className="mono-value">{state.deviceId}</dd>
                  </div>
                </dl>
                {state.issue && (
                  <p className="issue" role="status">
                    {state.issue}
                  </p>
                )}
                {failedMaterial && (
                  <dl className="settings-facts">
                    <div>
                      <dt>采集记录上传失败</dt>
                      <dd>
                        {state.materialIssue}
                        <div className="setting-actions">
                          <button
                            type="button"
                            disabled={!api || busy}
                            onClick={() =>
                              void change(() => api?.manageFailed(failedMaterial, true))
                            }
                          >
                            重试此项
                          </button>
                          <button
                            type="button"
                            disabled={!api || busy}
                            onClick={() =>
                              void change(() => api?.manageFailed(failedMaterial, false))
                            }
                          >
                            丢弃此项
                          </button>
                        </div>
                      </dd>
                    </div>
                  </dl>
                )}
              </>
            )}
            {!showConnection && (
              <>
                <div className="connection-mode-tabs" role="tablist" aria-label="连接方式">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!manual}
                    disabled={busy}
                    onClick={() => {
                      setManual(false)
                      setFeedback('')
                    }}
                  >
                    配对链接
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={manual}
                    disabled={busy}
                    onClick={() => {
                      setManual(true)
                      setFeedback('')
                    }}
                  >
                    手动配置
                  </button>
                </div>
                {!manual ? (
                  <form
                    className="connection-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void save()
                    }}
                  >
                    <p className="settings-note">
                      在后端管理面板点击「添加设备」，复制一次性配对链接粘贴至下方即可自动完成配置。
                    </p>
                    <label>
                      配对链接
                      <input
                        className="mono-input"
                        value={pairValue}
                        onChange={(event) => setPairValue(event.target.value)}
                        disabled={busy}
                        onPaste={(event) => {
                          const link = event.clipboardData.getData('text').trim()
                          if (!/^https:\/\/[^\s/?#@]+\/?#purin-pair=\d{5}-?\d{5}$/.test(link))
                            return
                          event.preventDefault()
                          setPairValue(link)
                          void save(link)
                        }}
                        placeholder="https://purin.example/#purin-pair=12345-67890"
                        autoComplete="off"
                        spellCheck={false}
                        required
                      />
                    </label>
                    <div className="connection-actions">
                      <Button type="submit" disabled={!api || busy}>
                        {busy ? '正在配对…' : '配对并连接'}
                      </Button>
                      {editing && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={cancelEdit}
                        >
                          取消
                        </Button>
                      )}
                    </div>
                  </form>
                ) : (
                  <form
                    className="connection-form connection-editor"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void save()
                    }}
                  >
                    <p className="settings-note connection-full-width">
                      {api
                        ? '填写后端服务根地址（不含 /v1）、设备标识与访问令牌。'
                        : '请打开 Purin 桌面应用以连接服务。'}
                    </p>
                    <label className="connection-full-width">
                      服务地址
                      <input
                        className="mono-input"
                        type="url"
                        value={url}
                        disabled={busy}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://purin.example"
                        required
                      />
                    </label>
                    <label>
                      设备名称
                      <input
                        value={deviceName}
                        disabled={busy}
                        onChange={(e) => setDeviceName(e.target.value)}
                        maxLength={80}
                        required
                      />
                    </label>
                    <label>
                      设备 ID
                      <input
                        className="mono-input"
                        value={deviceId}
                        disabled={busy}
                        onChange={(e) => setDeviceId(e.target.value)}
                        required
                      />
                    </label>
                    <label className="connection-full-width">
                      设备令牌
                      <div className="token-input-wrap">
                        <input
                          className="mono-input"
                          type={showToken ? 'text' : 'password'}
                          autoComplete="off"
                          spellCheck={false}
                          disabled={busy}
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                          placeholder={
                            state.configured &&
                            state.url === url.trim() &&
                            state.deviceId === deviceId.trim()
                              ? '留空以继续使用当前连接令牌'
                              : 'Bearer token'
                          }
                        />
                        <button
                          type="button"
                          className="token-visibility-btn"
                          aria-label={showToken ? '隐藏令牌' : '显示令牌'}
                          title={showToken ? '隐藏令牌' : '显示令牌'}
                          disabled={busy}
                          onClick={() => setShowToken((v) => !v)}
                        >
                          {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </label>
                    <div className="connection-actions connection-full-width">
                      <Button type="submit" disabled={!api || busy}>
                        {busy ? '正在验证…' : '验证并保存'}
                      </Button>
                      {editing && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={cancelEdit}
                        >
                          取消
                        </Button>
                      )}
                    </div>
                  </form>
                )}
              </>
            )}
            {feedback && (
              <p
                className={feedbackError ? 'connection-feedback error' : 'connection-feedback'}
                role="status"
              >
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
                  {Math.trunc(state.lastSpan.duration_seconds)} 秒
                  {state.lastSpan.window_title &&
                    ' · ' + state.lastSpan.window_title}
                  {state.lastSpan.input_segments?.length
                    ? ` · ${state.lastSpan.input_segments.length} 段输入`
                    : ''}
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
                  aria-describedby="text-input-description"
                  checked={!!state.textInputEnabled}
                  disabled={
                    !api || !state.configured || !state.collecting || busy
                  }
                  onChange={(e) => {
                    const enabled = e.target.checked
                    void change(() => api?.setTextInput({ enabled }))
                  }}
                />
                采集前台文本输入
              </label>
              <p id="text-input-description">
                通过系统辅助功能接口读取前台输入框的文本变化，跳过密码框，入队前遮盖疑似凭据、银行卡号和验证码。后端过滤空文本和超过 500 字的输入，并将保留的文本归到对应的窗口停留。
              </p>
              {state.textInputIssue && (
                <p role="status">{state.textInputIssue}</p>
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
                采集前台窗口截图
              </label>
              <p id="screenshot-description">
                同一应用连续在前台停留满 10
                分钟时截一张，切换标签页或窗口标题不会重新计时。
              </p>
              {state.screenshotIssue && (
                <p role="status">{state.screenshotIssue}</p>
              )}
            </div>
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
