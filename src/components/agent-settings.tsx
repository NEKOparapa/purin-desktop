import { useState } from 'react'
import {
  readBrowserAppearance,
  setBrowserAppearance,
  type AgentState,
  type Appearance,
} from '@/lib/desktop'
import { Button } from '@/components/ui/button'
import { ApiKeySettings } from '@/components/api-key-settings'
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const tabs = [
  { id: 'connection', label: '连接' },
  { id: 'keys', label: '接口密钥' },
  { id: 'appearance', label: '外观' },
  { id: 'capture', label: '信息采集' },
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
  const [terminal, setTerminal] = useState(state.terminal)
  const [token, setToken] = useState('')
  const [editing, setEditing] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('connection')
  const [sourceFeedback, setSourceFeedback] = useState('')
  const api = window.wintermute
  const connectionStatus = state.issue
    ? '连接异常'
    : state.configured
      ? '已连接'
      : '未连接'
  const failedMaterial = state.failedMaterial

  function editConnection() {
    setUrl(state.url)
    setTerminal(state.terminal)
    setToken('')
    setFeedback('')
    setEditing(true)
  }
  async function change(action: () => Promise<void> | undefined) {
    if (busy) return
    setBusy(true)
    setSourceFeedback('')
    try {
      await action()
    } catch (error) {
      setSourceFeedback(
        error instanceof Error
          ? error.message.replace(/^.*?Error: /, '')
          : '操作未完成，请重试',
      )
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
      await api.configure({ url, terminal, token })
      onConnected()
      setToken('')
      setEditing(false)
      setFeedback('连接已保存')
    } catch (error) {
      setFeedback(
        '连接失败 · ' +
          (error instanceof Error
            ? error.message.replace(/^.*?Error: /, '')
            : '请检查地址和终端令牌'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent
      className="detail-dialog settings-dialog"
      aria-describedby={undefined}
    >
      <DialogHeader>
        <DialogTitle>终端设置</DialogTitle>
      </DialogHeader>
      <nav className="setting-tabs" aria-label="设置分类">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'keys' && (
        <ApiKeySettings
          key={JSON.stringify([state.url, state.terminal, state.connectionRevision, state.configured])}
          configured={state.configured}
          revision={state.connectionRevision}
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
        <>
          <dl className="settings-facts">
            <div>
              <dt>连接状态</dt>
              <dd>{connectionStatus}</dd>
            </div>
            {state.configured && !editing && (
              <>
                <div>
                  <dt>终端 ID</dt>
                  <dd>{state.terminal}</dd>
                </div>
                <div>
                  <dt>服务地址</dt>
                  <dd>{state.url}</dd>
                </div>
              </>
            )}
          </dl>
          {state.issue && (
            <p className="issue" role="status">
              {state.issue}
            </p>
          )}
          {state.configured && !editing ? (
            <div className="connection-actions">
              <Button type="button" variant="outline" onClick={editConnection}>
                编辑连接
              </Button>
            </div>
          ) : (
            <form
              className="connection-form"
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
            >
              <p className="settings-note">
                {api
                  ? '使用后端为这台桌面设备分配的终端 ID 和令牌。'
                  : '请打开 Wintermute 桌面应用以连接服务。'}
              </p>
              <label>
                服务地址
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </label>
              <label>
                终端 ID
                <input
                  value={terminal}
                  onChange={(e) => setTerminal(e.target.value)}
                  required
                />
              </label>
              <label>
                终端令牌
                <input
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    state.configured &&
                    state.url === url.trim() &&
                    state.terminal === terminal.trim()
                      ? '留空以使用当前连接令牌'
                      : 'Bearer token'
                  }
                />
              </label>
              <div className="connection-actions">
                <Button type="submit" disabled={!api || busy}>
                  {busy ? '正在验证…' : '验证并保存'}
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
        </>
      )}
      {tab === 'capture' && (
        <>
          <div className="activity-settings">
            <label>
              <input
                type="checkbox"
                aria-describedby="desktop-activity-description"
                checked={state.collecting}
                disabled={!api || !state.configured}
                onChange={(e) => {
                  api
                    ?.setCollection(e.target.checked)
                    .catch(() => setSourceFeedback('无法保存采集设置'))
                }}
              />{' '}
              采集桌面活动
            </label>
            <p id="desktop-activity-description">
              同一应用停留满 5 秒，离开后才记一条，保留最后可读的窗口标题。切换标签页合并计时，可在「记忆 → 感知层」查看。
            </p>
            {state.collecting && navigator.platform.startsWith('Mac') && (
              <p>
                macOS 读取窗口标题可能需要在系统设置中允许辅助功能和自动化。
              </p>
            )}
            {state.lastSpan && (
              <p>
                最近一次停留 · {new Date(state.lastSpan.ended_at).toLocaleString('zh-CN')}
                {' · '}{state.lastSpan.foreground_app} · 约 {state.lastSpan.duration_seconds} 秒
                {state.lastSpan.window_title && ' · ' + state.lastSpan.window_title}
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
                checked={!!state.screenshotsEnabled}
                disabled={
                  !api || !state.configured || !state.collecting || busy
                }
                onChange={(e) => {
                  const enabled = e.target.checked
                  void change(() =>
                    api?.setScreenshots({ enabled }),
                  )
                }}
              />
              自动截图（前台窗口）
            </label>
            <p>
              窗口标题稳定 10 秒后截第一张，此后每分钟截一张。每段标题最多保留开头、中间和最后三张，离开应用后一起上传。截图和识别结果可在「记忆 → 感知层 → 格式化信息」查看。
            </p>
            {state.screenshotIssue && (
              <p role="status">{state.screenshotIssue}</p>
            )}
          </div>
          {(state.lastMaterial ||
            state.pendingMaterials > 0 ||
            state.materialIssue) && (
            <dl className="settings-facts" aria-label="材料传送状态">
              {state.lastMaterial && (
                <div>
                  <dt>最近送达的材料</dt>
                  <dd>
                    {state.lastMaterial.label} ·{' '}
                    {new Date(state.lastMaterial.at).toLocaleString('zh-CN')}
                  </dd>
                </div>
              )}
              {(state.pendingMaterials > 0 || state.materialIssue) && (
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
              )}
            </dl>
          )}
          {sourceFeedback && (
            <p className="source-feedback" role="status">
              {sourceFeedback}
            </p>
          )}
        </>
      )}
    </DialogContent>
  )
}
