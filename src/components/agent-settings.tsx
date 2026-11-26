import { translateKnown, language, languageOptions, saveLanguage, t, type Language } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import {
  Activity,
  Cable,
  Check,
  Cpu,
  Eye,
  EyeOff,
  Minimize2,
  Monitor,
  Moon,
  Plug,
  Power,
  RefreshCw,
  Server,
  Settings,
  Smartphone,
  Sun,
} from 'lucide-react'
import {
  readBrowserAppearance,
  readBrowserCloseAction,
  setBrowserAppearance,
  setBrowserCloseAction,
  type AgentState,
  type Appearance,
  type CloseAction,
  type OnlineDevice,
} from '@/lib/desktop'
import { Button } from '@/components/ui/button'
import { ConnectorSettings } from '@/components/connector-settings'
import { DialogTitle } from '@/components/ui/dialog'

const sections = [
  { id: 'connection', label: '设备配对', icon: Cable },
  { id: 'collection', label: '信息采集', icon: Activity },
  { id: 'connectors', label: '连接器', icon: Plug },
  { id: 'appearance', label: '应用设置', icon: Settings },
] as const
type Section = (typeof sections)[number]['id']

const devicePlatformLabels = { windows: 'Windows', macos: 'macOS' }
const onlinePlatformLabels: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  android: 'Android',
  ios: 'iOS',
  esp32: 'ESP32',
}
const onlineTypeLabels: Record<string, string> = {
  desktop: '桌面端',
  mobile: '手机',
  esp32: 'ESP32',
}

function onlineDevicePlatformLabel(item: OnlineDevice) {
  if (item.platform && onlinePlatformLabels[item.platform]) {
    return onlinePlatformLabels[item.platform]
  }
  if (item.device_type && onlineTypeLabels[item.device_type]) {
    return translateKnown(onlineTypeLabels[item.device_type])
  }
  return t('HTTP 设备')
}

function OnlineDeviceGlyph({ item }: { item: OnlineDevice }) {
  if (
    item.device_type === 'mobile' ||
    item.platform === 'android' ||
    item.platform === 'ios'
  ) {
    return <Smartphone size={16} aria-hidden="true" />
  }
  if (item.device_type === 'esp32' || item.platform === 'esp32') {
    return <Cpu size={16} aria-hidden="true" />
  }
  if (
    item.device_type === 'desktop' ||
    item.platform === 'windows' ||
    item.platform === 'macos'
  ) {
    return <Monitor size={16} aria-hidden="true" />
  }
  return <Server size={16} aria-hidden="true" />
}

function OnlineDevicesCard() {
  const api = window.purin
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(() => Boolean(api?.onlineDevices))
  const [refreshing, setRefreshing] = useState(false)
  const [items, setItems] = useState<OnlineDevice[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!api?.onlineDevices) return
    let active = true
    const load = () => {
      api.onlineDevices?.().then(
        (snapshot) => {
          if (!active) return
          setItems(Array.isArray(snapshot.items) ? snapshot.items : [])
          setError('')
          setLoading(false)
          setRefreshing(false)
        },
        (err) => {
          if (!active) return
          setError(
            err instanceof Error && err.message
              ? translateKnown(err.message.replace(/^.*?Error: /, ''))
              : t('读取在线设备信息失败'),
          )
          setLoading(false)
          setRefreshing(false)
        },
      )
    }
    load()
    const timer = window.setInterval(load, 8000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [api, attempt])

  const reload = () => {
    if (!api?.onlineDevices || loading || refreshing) return
    setRefreshing(true)
    setError('')
    setAttempt((n) => n + 1)
  }

  return (
    <section className="connection-card" aria-labelledby="online-devices-title">
      <header className="connection-card-header">
        <div className="connection-card-heading">
          <h4 id="online-devices-title">{t('在线设备')}</h4>
          {!loading && !error && (
            <span className="connection-platform-tag">{items.length}{t(' 台在线')}</span>
          )}
        </div>
        {api?.onlineDevices && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading || refreshing}
            onClick={reload}
          >
            <RefreshCw
              size={13.5}
              aria-hidden="true"
              className="online-refresh-icon"
              data-spinning={loading || refreshing}
            />
            {t('刷新')}
          </Button>
        )}
      </header>
      {!api?.onlineDevices ? (
        <p className="settings-note">{t('请打开最新版 Purin 桌面应用以查看在线设备信息。')}</p>
      ) : loading ? (
        <p className="settings-note" role="status">
          {t('正在获取在线设备信息…')}
        </p>
      ) : error ? (
        <p className="issue" role="status">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className="settings-note">{t('当前暂无在线设备。')}</p>
      ) : (
        <ul className="online-device-list" aria-label={t('在线设备列表')}>
          {items.map((item) => (
            <li key={item.device_id} className="online-device-item">
              <div className="online-device-main">
                <span className="online-device-icon">
                  <OnlineDeviceGlyph item={item} />
                </span>
                <div className="online-device-info">
                  <div className="online-device-title-row">
                    <span className="online-device-name">{item.name}</span>
                    {item.is_current && (
                      <span className="online-device-self-badge">{t('本机')}</span>
                    )}
                  </div>
                  <span className="online-device-id mono-value">{item.device_id}</span>
                </div>
              </div>
              <div className="online-device-meta">
                <span className="connection-platform-tag">
                  {onlineDevicePlatformLabel(item)}
                </span>
                <span className="connection-status" data-state="connected">
                  {t('在线')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
const appearanceOptions = [
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
const closeActionOptions = [
  {
    value: 'tray',
    label: '最小化到托盘',
    description: '点击窗口关闭按钮时隐藏主界面并保留系统托盘图标，后台继续接收通知与采集活动。',
    icon: Minimize2,
  },
  {
    value: 'quit',
    label: '直接退出应用',
    description: '点击窗口关闭按钮时直接关闭窗口并退出 Purin 进程。',
    icon: Power,
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
  const [languageError, setLanguageError] = useState(false)
  const [appearanceError, setAppearanceError] = useState('')
  const [browserCloseAction, setBrowserCloseActionState] = useState(readBrowserCloseAction)
  const [closeActionError, setCloseActionError] = useState('')
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
  const connectionStatus = { error: t('连接异常'), connected: t('已连接'), disconnected: t('未连接') }
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
            ? translateKnown(error.message.replace(/^.*?Error: /, ''))
            : t('操作未完成，请重试'),
      })
    } finally {
      setBusy(false)
    }
  }
  async function chooseLanguage(value: Language) {
    try {
      await saveLanguage(value)
      setLanguageError(false)
    } catch {
      setLanguageError(true)
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
      setAppearanceError(t('外观设置未保存，请重试。'))
    }
  }
  const closeAction = api ? state.closeAction : browserCloseAction
  async function chooseCloseAction(action: CloseAction) {
    try {
      if (api) await api.setCloseAction(action)
      else {
        setBrowserCloseAction(action)
        setBrowserCloseActionState(action)
      }
      setCloseActionError('')
    } catch {
      setCloseActionError(t('关闭按钮设置未保存，请重试。'))
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
      setFeedback(t('连接已验证并保存'))
    } catch (error) {
      setFeedbackError(true)
      setFeedback(
        t('连接失败 · ') +
          (error instanceof Error
            ? translateKnown(error.message.replace(/^.*?Error: /, ''))
            : t('请检查服务地址和连接凭据')),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="settings-sidebar">
        <DialogTitle>{t('设备设置')}</DialogTitle>
        <nav className="nav-list" aria-label={t('设置分类')}>
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className="nav-item"
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              aria-label={t(label)}
              title={t(label)}
              onClick={() => setTab(id)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{t(label)}</span>
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
          {t(sections.find(({ id }) => id === tab)!.label)}
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
          <>
            <section className="connection-card" aria-labelledby="language-title">
              <header className="connection-card-header">
                <h4 id="language-title">{t('界面语言')}</h4>
              </header>
              <fieldset className="appearance-settings" aria-labelledby="language-title">
                <div className="theme-grid">
                  {languageOptions.map(({ value, label }) => (
                    <label
                      key={value}
                      className="theme-option close-action-option"
                      data-selected={language() === value}
                    >
                      <input
                        type="radio"
                        name="language"
                        checked={language() === value}
                        onChange={() => void chooseLanguage(value)}
                      />
                      <span className="theme-option-footer">
                        <span lang={value}>{label}</span>
                        <span className="theme-option-check" aria-hidden="true">
                          {language() === value && <Check size={11} strokeWidth={2.8} />}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {languageError && (
                <p className="issue" role="status">{t('语言设置未保存，请重试。')}</p>
              )}
            </section>
            <section
              className="connection-card appearance-card"
              aria-labelledby="appearance-theme-title"
            >
              <header className="connection-card-header">
                <div className="connection-card-heading">
                  <h4 id="appearance-theme-title">{t('界面主题')}</h4>
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
                        </span>
                        <span className="theme-option-footer">
                          <span className="theme-option-label">
                            <Icon size={15} aria-hidden="true" />
                            {t(label)}
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
                {t(appearanceOptions.find((item) => item.value === appearance)!.description)}
                {t('外观偏好仅保存在当前设备上，主窗口与桌宠气泡会立即同步。')}
              </p>
              {appearanceError && (
                <p className="issue" role="status">
                  {appearanceError}
                </p>
              )}
            </section>
            <section
              className="connection-card"
              aria-labelledby="close-action-title"
            >
              <header className="connection-card-header">
                <div className="connection-card-heading">
                  <h4 id="close-action-title">{t('窗口关闭按钮')}</h4>
                </div>
              </header>
              <fieldset className="appearance-settings" aria-labelledby="close-action-title">
                <div className="theme-grid">
                  {closeActionOptions.map(({ value, label, icon: Icon }) => {
                    const selected = closeAction === value
                    return (
                      <label
                        key={value}
                        className="theme-option close-action-option"
                        data-selected={selected}
                      >
                        <input
                          type="radio"
                          name="closeAction"
                          checked={selected}
                          onChange={() => void chooseCloseAction(value)}
                        />
                        <span className="theme-option-footer">
                          <span className="theme-option-label">
                            <Icon size={15} aria-hidden="true" />
                            {t(label)}
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
                {t(closeActionOptions.find((item) => item.value === closeAction)!.description)}
                {t('右键系统托盘图标可随时选择「显示界面」或「退出应用」。')}
              </p>
              {closeActionError && (
                <p className="issue" role="status">
                  {closeActionError}
                </p>
              )}
            </section>
          </>
        )}
        {tab === 'connection' && (
          <>
            <section className="connection-card" aria-labelledby="device-connection-title">
            <header className="connection-card-header">
              <div className="connection-card-heading">
                <h4 id="device-connection-title">
                  {showConnection
                    ? t('当前连接')
                    : editing
                      ? t('编辑连接')
                      : t('连接后端服务')}
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
                  {t('编辑连接')}
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
                  {t('取消')}
                </Button>
              )}
            </header>
            {showConnection && (
              <>
                <dl className="connection-details">
                  <div className="connection-detail-item">
                    <dt>
                      {t('设备名称')}
                      </dt>
                    <dd>{state.deviceName}</dd>
                  </div>
                  <div className="connection-detail-item">
                    <dt>{t('设备平台')}</dt>
                    <dd>
                      {state.devicePlatform
                        ? devicePlatformLabels[state.devicePlatform]
                        : t('未知')}
                    </dd>
                  </div>
                  <div className="connection-detail-item">
                    <dt>
                      {t('服务地址')}
                      </dt>
                    <dd className="mono-value">{state.url}</dd>
                  </div>
                  <div className="connection-detail-item">
                    <dt>
                      {t('设备 ID')}
                      </dt>
                    <dd className="mono-value">{state.deviceId}</dd>
                  </div>
                </dl>
                {state.issue && (
                  <p className="issue" role="status">
                    {translateKnown(state.issue)}
                  </p>
                )}
                {failedMaterial && (
                  <dl className="settings-facts">
                    <div>
                      <dt>{t('采集记录上传失败')}</dt>
                      <dd>
                        {translateKnown(state.materialIssue)}
                        <div className="setting-actions">
                          <button
                            type="button"
                            disabled={!api || busy}
                            onClick={() =>
                              void change(() => api?.manageFailed(failedMaterial, true))
                            }
                          >
                            {t('重试此项')}
                          </button>
                          <button
                            type="button"
                            disabled={!api || busy}
                            onClick={() =>
                              void change(() => api?.manageFailed(failedMaterial, false))
                            }
                          >
                            {t('丢弃此项')}
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
                <div className="connection-mode-tabs" role="tablist" aria-label={t('连接方式')}>
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
                      {t('配对链接')}
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
                    {t('手动配置')}
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
                      {t('在后端管理面板点击「添加设备」，复制一次性配对链接粘贴至下方即可自动完成配置。')}
                    </p>
                    <label>
                      {t('配对链接')}
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
                        {busy ? t('正在配对…') : t('配对并连接')}
                      </Button>
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
                        ? t('填写后端服务根地址（不含 /v1）、设备标识与访问令牌。')
                        : t('请打开 Purin 桌面应用以连接服务。')}
                    </p>
                    <label className="connection-full-width">
                      {t('服务地址')}
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
                      {t('设备名称')}
                      <input
                        value={deviceName}
                        disabled={busy}
                        onChange={(e) => setDeviceName(e.target.value)}
                        maxLength={80}
                        required
                      />
                    </label>
                    <label>
                      {t('设备 ID')}
                      <input
                        className="mono-input"
                        value={deviceId}
                        disabled={busy}
                        onChange={(e) => setDeviceId(e.target.value)}
                        required
                      />
                    </label>
                    <label className="connection-full-width">
                      {t('设备令牌')}
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
                              ? t('留空以继续使用当前连接令牌')
                              : 'Bearer token'
                          }
                        />
                        <button
                          type="button"
                          className="token-visibility-btn"
                          aria-label={showToken ? t('隐藏令牌') : t('显示令牌')}
                          title={showToken ? t('隐藏令牌') : t('显示令牌')}
                          disabled={busy}
                          onClick={() => setShowToken((v) => !v)}
                        >
                          {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </label>
                    <div className="connection-actions connection-full-width">
                      <Button type="submit" disabled={!api || busy}>
                        {busy ? t('正在验证…') : t('验证并保存')}
                      </Button>
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
            {showConnection && (
              <OnlineDevicesCard
                key={JSON.stringify([
                  state.url,
                  state.deviceId,
                  state.connectionRevision,
                ])}
              />
            )}
          </>
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
                {t('采集桌面活动')}
              </label>
              <p id="desktop-activity-description">
                {t('约每秒采样一次，未操作键鼠也会累计前台停留。切走或锁屏后上传本次停留及窗口标题变化，包括短停留。在后端管理面板的「历史记录 → 感知层」可查看原始记录和后端的过滤原因。')}
              </p>
              {state.collecting && navigator.platform.startsWith('Mac') && (
                <p>
                  {t('macOS 读取窗口标题可能需要在系统设置中允许辅助功能和自动化。')}
                </p>
              )}
              {state.lastSpan && (
                <p>
                  {t('最近一次停留 ·')}{' '}
                  {new Date(state.lastSpan.ended_at).toLocaleString(language())}
                  {' · '}
                  {state.lastSpan.foreground_app}{t(' · 约 {0} 秒', Math.trunc(state.lastSpan.duration_seconds))}{state.lastSpan.window_title &&
                    ' · ' + state.lastSpan.window_title}
                  {state.lastSpan.input_segments?.length
                    ? t(' · {0} 段输入', state.lastSpan.input_segments.length)
                    : ''}
                </p>
              )}
              {state.sampleIssue && (
                <p role="status">{t('桌面采样待重试 · ')}{translateKnown(state.sampleIssue)}</p>
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
                {t('采集前台文本输入')}
              </label>
              <p id="text-input-description">
                {t('通过系统辅助功能接口读取前台输入框的文本变化，跳过密码框，入队前遮盖疑似凭据、银行卡号和验证码。后端过滤空文本和超过 500 字的输入，并将保留的文本归到对应的窗口停留。')}
              </p>
              {state.textInputIssue && (
                <p role="status">{translateKnown(state.textInputIssue)}</p>
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
                {t('采集前台窗口截图')}
              </label>
              <p id="screenshot-description">
                {t('同一应用连续在前台停留满 10 分钟时截一张，切换标签页或窗口标题不会重新计时。')}
              </p>
              {state.screenshotIssue && (
                <p role="status">{translateKnown(state.screenshotIssue)}</p>
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
