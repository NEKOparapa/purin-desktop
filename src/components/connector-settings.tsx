import { language, translateKnown, t } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  ConnectorItem,
  MacConnectorState,
  ObsidianConnectorState,
} from '@/lib/desktop'
import './connector-settings.css'

function cleanError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return translateKnown(error.message.replace(/^.*?Error: /, ''))
  }
  return fallback
}

function statusLabel(item: ConnectorItem) {
  if (item.connected) return t('已连接')
  if (item.status === 'pending_auth') return t('待授权')
  if (item.status === 'offline') return t('离线')
  if (item.status === 'unverified') return t('未验证')
  return t('未连接')
}

export function ConnectorSettings({
  configured,
  revision,
  remoteCommandsEnabled,
  remoteTools,
  remoteIssue,
  macConnectors = [],
}: {
  configured: boolean
  revision?: number
  remoteCommandsEnabled?: boolean
  remoteTools?: string[]
  remoteIssue?: string
  macConnectors?: MacConnectorState[]
}) {
  const api = window.purin
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<ConnectorItem[]>([])
  const [obsidian, setObsidian] = useState<ObsidianConnectorState | null>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')

  // Add MCP form state
  const [addingMcp, setAddingMcp] = useState(false)
  const [mcpName, setMcpName] = useState('')
  const [mcpEndpoint, setMcpEndpoint] = useState('')
  const [mcpSourceKind, setMcpSourceKind] = useState<'official' | 'third_party'>('official')
  const [mcpFoundAt, setMcpFoundAt] = useState('')
  const [mcpPublisher, setMcpPublisher] = useState('')
  const [mcpAuthType, setMcpAuthType] = useState<'none' | 'header' | 'query'>('none')
  const [mcpAuthKey, setMcpAuthKey] = useState('Authorization')
  const [mcpAuthValue, setMcpAuthValue] = useState('')

  // Inline credential update state
  const [credTarget, setCredTarget] = useState<string | null>(null)
  const [credValue, setCredValue] = useState('')

  const reload = () => {
    setLoading(true)
    setError('')
    setAttempt((n) => n + 1)
  }

  useEffect(() => {
    if (!api?.connectors) return
    let active = true
    api.connectors().then(
      (snapshot) => {
        if (!active) return
        setItems(snapshot.items)
        setObsidian(snapshot.obsidian)
        setLoading(false)
      },
      (err) => {
        if (!active) return
        setError(cleanError(err, t('读取连接器列表失败')))
        setLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [api, attempt, configured, revision])

  if (!api || !api.connectors || !api.setObsidianConnector) {
    return (
      <p className="settings-note">
        {t('请打开最新版 Purin 桌面应用以管理连接器。')}
      </p>
    )
  }

  const mcpItems = items.filter((item) => item.tool_type === 'mcp')
  const canSetMacConnector = Boolean(api.setMacConnector)

  async function connectObsidianPath(vaultPath: string) {
    if (!api?.setObsidianConnector || busy) return
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      const next = await api.setObsidianConnector({
        enabled: true,
        vaultPath,
        connectionRevision: revision,
      })
      setObsidian(next)
      setFeedback(t('已连接 Obsidian 仓库「{0}」（共 {1} 篇笔记）。', next.vaultName, next.noteCount))
      reload()
    } catch (err) {
      setError(cleanError(err, t('连接 Obsidian 失败')))
    } finally {
      setBusy(false)
    }
  }

  async function pickObsidianFolder() {
    if (!api?.chooseObsidianVault || busy) return
    const selected = await api.chooseObsidianVault()
    if (selected) {
      await connectObsidianPath(selected)
    }
  }

  async function toggleTerminalConnector(enabled: boolean) {
    if (!api?.setRemoteCommands || busy) return
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      await api.setRemoteCommands({
        enabled,
        connectionRevision: revision,
      })
      setFeedback(enabled ? t('已连接本机命令行连接器。') : t('已断开本机命令行连接器。'))
      reload()
    } catch (err) {
      setError(cleanError(err, t('切换本机命令行连接器失败')))
    } finally {
      setBusy(false)
    }
  }

  async function toggleMacConnector(app: MacConnectorState) {
    if (!api?.setMacConnector || revision === undefined || busy) return
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      await api.setMacConnector({ id: app.id, enabled: !app.enabled, connectionRevision: revision })
    } catch (err) {
      setError(cleanError(err, t('更新 Mac 连接器失败')))
    } finally {
      setBusy(false)
    }
  }

  async function disconnectObsidian() {
    if (!api?.setObsidianConnector || busy) return
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      const next = await api.setObsidianConnector({
        enabled: false,
        connectionRevision: revision,
      })
      setObsidian(next)
      setFeedback(t('已断开 Obsidian 连接器。'))
      reload()
    } catch (err) {
      setError(cleanError(err, t('断开 Obsidian 失败')))
    } finally {
      setBusy(false)
    }
  }

  async function submitMcp(event: React.FormEvent) {
    event.preventDefault()
    if (!api?.addMcpConnector || busy) return
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      const keyName = mcpAuthKey.trim() || 'Authorization'
      const trimmedVal = mcpAuthValue.trim()
      const payload = {
        name: mcpName.trim(),
        endpoint: mcpEndpoint.trim(),
        source: {
          kind: mcpSourceKind,
          found_at: mcpFoundAt.trim() || mcpEndpoint.trim(),
          publisher: mcpPublisher.trim() || mcpName.trim(),
        },
        header_names: mcpAuthType === 'header' ? [keyName] : [],
        credential_query_param: mcpAuthType === 'query' ? keyName : null,
        credential_label: mcpAuthType === 'none' ? null : keyName,
        credentials: mcpAuthType !== 'none' && trimmedVal ? { [keyName]: trimmedVal } : null,
      }
      const res = await api.addMcpConnector(payload)
      setAddingMcp(false)
      setMcpName('')
      setMcpEndpoint('')
      setMcpFoundAt('')
      setMcpPublisher('')
      setMcpAuthValue('')
      if (res.verify_error) {
        setFeedback(t('已添加「{0}」，但验证未通过：{1}', res.item.name, res.verify_error))
      } else if (res.item.connected) {
        setFeedback(
          t('已连接「{0}」{1}。', res.item.name, res.tool_count !== null ? t('（发现 {0} 个工具）', res.tool_count) : ''),
        )
      } else {
        setFeedback(t('已登记「{0}」（待授权），请配置凭据后使用。', res.item.name))
      }
      reload()
    } catch (err) {
      setError(cleanError(err, t('添加 MCP 服务失败')))
    } finally {
      setBusy(false)
    }
  }

  async function submitCredentials(item: ConnectorItem) {
    if (!api?.saveConnectorCredentials || busy || !credValue.trim()) return
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      const fieldName =
        item.header_names[0] ||
        item.credential_query_param ||
        item.credential_label ||
        'Authorization'
      const res = await api.saveConnectorCredentials({
        id: item.id,
        values: { [fieldName]: credValue.trim() },
      })
      setCredTarget(null)
      setCredValue('')
      if (res.verify_error) {
        setError(t('凭据已保存，但验证失败：{0}', res.verify_error))
      } else {
        setFeedback(
          t('「{0}」凭据已验证通过{1}。', item.name, res.tool_count !== null ? t('（发现 {0} 个工具）', res.tool_count) : ''),
        )
      }
      reload()
    } catch (err) {
      setError(cleanError(err, t('保存凭据失败')))
    } finally {
      setBusy(false)
    }
  }

  async function testMcp(item: ConnectorItem) {
    if (!api?.testConnector || busy) return
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      const res = await api.testConnector(item.id)
      if (res.verify_error) {
        setError(t('「{0}」连接测试失败：{1}', item.name, res.verify_error))
      } else {
        setFeedback(
          t('「{0}」连接正常{1}。', item.name, res.tool_count !== null ? t('（发现 {0} 个工具）', res.tool_count) : ''),
        )
      }
      reload()
    } catch (err) {
      setError(cleanError(err, t('测试连接器失败')))
    } finally {
      setBusy(false)
    }
  }

  async function removeConnector(item: ConnectorItem) {
    if (!api?.deleteConnector || busy) return
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      await api.deleteConnector(item.id)
      setFeedback(t('已移除连接器「{0}」。', item.name))
      reload()
    } catch (err) {
      setError(cleanError(err, t('移除连接器失败')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="connector-settings">
      {error && (
        <p className="issue" role="alert">
          {error}
        </p>
      )}
      {feedback && (
        <p className="source-feedback" role="status">
          {feedback}
        </p>
      )}

      <section className="connector-group" aria-label={t('Windows 连接器')}>
        <div className="connector-group-header">
          <h4>Windows</h4>
        </div>
        <article className="connector-card">
          <div className="connector-card-head">
            <div>
              <div className="connector-card-title">
                <h5>Obsidian</h5>
                <Badge variant={obsidian?.enabled ? 'default' : 'secondary'}>
                  {obsidian?.enabled ? t('已连接') : t('未连接')}
                </Badge>
              </div>
              <p className="connector-card-meta">
                {t('授权 Agent 在指定仓库目录内检索、阅读和写入 Markdown 笔记（无需开启终端命令行权限）。')}
              </p>
            </div>
            <div className="connector-card-actions">
              {obsidian?.enabled ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void disconnectObsidian()}
                >
                  {t('断开')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void pickObsidianFolder()}
                >
                  <FolderOpen size={14} aria-hidden="true" />
                  {t('选择仓库')}
                </Button>
              )}
            </div>
          </div>

          {obsidian?.enabled && (
            <div className="connector-vault-bar">
              <div className="connector-vault-line" title={obsidian.vaultPath}>
                <span>{t('当前仓库：')}</span>
                <code>{obsidian.vaultPath}</code>
                <span>{t('（{0} 篇笔记）', obsidian.noteCount)}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={busy}
                onClick={() => void pickObsidianFolder()}
              >
                <FolderOpen size={13} aria-hidden="true" />
                {t('切换仓库')}
              </Button>
            </div>
          )}

          {!obsidian?.enabled && obsidian?.detectedVaults?.length ? (
            <div className="connector-vault-info">
              <span>{t('检测到本机 Obsidian 仓库（点击一键连接）：')}</span>
              <div className="connector-detected-list">
                {obsidian.detectedVaults.map((vault) => (
                  <Button
                    key={vault.id}
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    title={vault.path}
                    onClick={() => void connectObsidianPath(vault.path)}
                  >
                    {vault.name}
                    {vault.open ? t('（当前打开）') : ''}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {!configured && (
            <p className="connector-card-meta">
              {t('提示：连接后端服务后，Obsidian 连接器会自动同步给主 Agent 使用。')}
            </p>
          )}
        </article>

        <article className="connector-card">
          <div className="connector-card-head">
            <div>
              <div className="connector-card-title">
                <h5>{t('本机命令行')}</h5>
                <Badge variant={remoteCommandsEnabled ? 'default' : 'secondary'}>
                  {remoteCommandsEnabled ? t('已连接') : t('未连接')}
                </Badge>
              </div>
              <p className="connector-card-meta">
                {t('开启后，主 Agent 可以当前用户权限在本机运行命令（高权限，关闭会立即中止正在运行的命令）。调用记录可在后端管理面板的「历史记录 → 连接器」中查看。')}
              </p>
            </div>
            <div className="connector-card-actions">
              <Button
                type="button"
                variant={remoteCommandsEnabled ? 'ghost' : 'outline'}
                size="sm"
                disabled={
                  !configured ||
                  busy ||
                  (!remoteCommandsEnabled && !remoteTools?.length)
                }
                onClick={() => void toggleTerminalConnector(!remoteCommandsEnabled)}
              >
                {remoteCommandsEnabled ? t('断开') : t('连接')}
              </Button>
            </div>
          </div>
          <div className="connector-vault-info">
            <span>
              {!configured
                ? t('连接设备后可启用本机命令行。')
                : remoteTools?.length
                  ? t('可用工具：{0}', remoteTools.join(language() === 'en' ? ', ' : '、'))
                  : t('暂无可用命令行工具（请确认使用 HTTPS 或本机地址连接）。')}
            </span>
            {remoteIssue && <span role="status">{translateKnown(remoteIssue)}</span>}
          </div>
        </article>
      </section>

      {macConnectors.length > 0 && (
        <section className="connector-group" aria-label={t('Mac 应用连接器')}>
          <div className="connector-group-header">
            <h4>{t('Mac 应用')}</h4>
          </div>
          {!canSetMacConnector && (
            <p className="settings-note">{t('这些连接器仅可在 macOS 上启用。')}</p>
          )}
          {macConnectors.map((app) => (
            <article className="connector-card" key={app.id}>
              <div className="connector-card-head">
                <div>
                  <div className="connector-card-title">
                    <h5>{translateKnown(app.name)}</h5>
                    <Badge variant={app.enabled ? 'default' : 'secondary'}>
                      {app.enabled ? t('已启用') : t('未启用')}
                    </Badge>
                  </div>
                  <p className="connector-card-meta">{translateKnown(app.description)}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={app.enabled ? 'ghost' : 'outline'}
                  aria-label={t(app.enabled ? '关闭 {0}' : '启用 {0}', translateKnown(app.name))}
                  disabled={!canSetMacConnector || busy || !configured || revision === undefined}
                  onClick={() => void toggleMacConnector(app)}
                >
                  {app.enabled ? t('关闭') : t('启用')}
                </Button>
              </div>
            </article>
          ))}
          {canSetMacConnector && (
            <p className="settings-note">
              {configured
                ? t('首次调用访达、备忘录或音乐时，macOS 可能会请求自动化权限。')
                : t('连接设备后可启用 Mac 应用。')}
            </p>
          )}
        </section>
      )}

      <section className="connector-group" aria-label={t('MCP 服务')}>
        <div className="connector-group-header">
          <h4>{t('MCP 服务')}</h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !configured}
            onClick={() => setAddingMcp((prev) => !prev)}
          >
            <Plus size={14} aria-hidden="true" />
            {t('添加 MCP')}
          </Button>
        </div>

        {!configured && (
          <p className="settings-note">
            {t('请先在「设备配对」中连接后端服务，再添加或管理 MCP 服务。')}
          </p>
        )}

        {configured && addingMcp && (
          <form
            className="connector-card connection-form"
            onSubmit={(event) => void submitMcp(event)}
          >
            <div className="connector-form-grid">
              <label>
                {t('显示名')}
                <input
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                  placeholder={t('例如：GitHub / Notion')}
                  required
                />
              </label>
              <label>
                {t('来源类型')}
                <select
                  value={mcpSourceKind}
                  onChange={(e) =>
                    setMcpSourceKind(e.target.value as 'official' | 'third_party')
                  }
                >
                  <option value="official">{t('官方 (official)')}</option>
                  <option value="third_party">{t('第三方 (third_party)')}</option>
                </select>
              </label>
              <label className="connector-span-2">
                {t('Streamable HTTP 地址（仅支持 https://）')}
                <input
                  type="url"
                  value={mcpEndpoint}
                  onChange={(e) => setMcpEndpoint(e.target.value)}
                  placeholder="https://example.com/mcp"
                  required
                />
              </label>
              <label>
                {t('官方文档地址')}
                <input
                  type="url"
                  value={mcpFoundAt}
                  onChange={(e) => setMcpFoundAt(e.target.value)}
                  placeholder="https://docs.example.com/mcp"
                />
              </label>
              <label>
                {t('运营方')}
                <input
                  value={mcpPublisher}
                  onChange={(e) => setMcpPublisher(e.target.value)}
                  placeholder={t('例如：GitHub Inc.')}
                />
              </label>
              <label>
                {t('鉴权方式')}
                <select
                  value={mcpAuthType}
                  onChange={(e) => {
                    const next = e.target.value as 'none' | 'header' | 'query'
                    setMcpAuthType(next)
                    if (next === 'header' && !mcpAuthKey) setMcpAuthKey('Authorization')
                    if (next === 'query' && mcpAuthKey === 'Authorization') setMcpAuthKey('api_key')
                  }}
                >
                  <option value="none">{t('无需凭据')}</option>
                  <option value="header">{t('请求头 (Header)')}</option>
                  <option value="query">{t('URL 参数 (Query)')}</option>
                </select>
              </label>
              {mcpAuthType !== 'none' && (
                <label>
                  {mcpAuthType === 'header' ? t('请求头名称') : t('Query 参数名')}
                  <input
                    value={mcpAuthKey}
                    onChange={(e) => setMcpAuthKey(e.target.value)}
                    placeholder={mcpAuthType === 'header' ? t('X-Api-Key 或 Authorization') : 'api_key'}
                    required
                  />
                </label>
              )}
              {mcpAuthType !== 'none' && (
                <label className="connector-span-2">
                  {t('凭据值（可选，留空则保存为待授权）')}
                  <input
                    type="password"
                    autoComplete="off"
                    value={mcpAuthValue}
                    onChange={(e) => setMcpAuthValue(e.target.value)}
                    placeholder={t('API Key 或 Token')}
                  />
                </label>
              )}
            </div>
            <div className="connection-actions">
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? t('保存并验证中…') : t('保存并验证')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setAddingMcp(false)}
              >
                    {t('取消')}
                  </Button>
            </div>
          </form>
        )}

        {configured && !loading && !error && mcpItems.length === 0 && !addingMcp && (
          <p className="settings-note">
            {t('暂未添加 MCP 服务。点击右上角「添加 MCP」，或直接在对话中让 Agent 使用 ConnectorSetup 登记。')}
          </p>
        )}

        {mcpItems.map((item) => (
          <article key={item.id} className="connector-card">
            <div className="connector-card-head">
              <div>
                <div className="connector-card-title">
                  <h5>{item.name}</h5>
                  <Badge variant={item.connected ? 'default' : 'secondary'}>
                    {statusLabel(item)}
                  </Badge>
                  <Badge variant="outline">mcp</Badge>
                  {item.source && (
                    <Badge variant="outline">
                      {item.source.kind === 'official' ? t('官方') : t('第三方')}
                    </Badge>
                  )}
                </div>
                {item.endpoint && (
                  <p className="connector-card-meta">
                    <code>{item.endpoint}</code>
                  </p>
                )}
              </div>
              <div className="connector-card-actions">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setCredTarget(credTarget === item.id ? null : item.id)
                    setCredValue('')
                  }}
                >
                  {item.has_credentials ? t('更新凭据') : t('配置凭据')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void testMcp(item)}
                >
                  {t('测试')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('删除 {0}', item.name)}
                  disabled={busy}
                  onClick={() => void removeConnector(item)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </div>
            </div>

            {credTarget === item.id && (
              <form
                className="connection-form connector-cred-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void submitCredentials(item)
                }}
              >
                <label>
                  {item.credential_label ||
                    item.header_names[0] ||
                    item.credential_query_param ||
                    'API Key / Token'}
                  <input
                    autoFocus
                    type="password"
                    autoComplete="off"
                    value={credValue}
                    onChange={(e) => setCredValue(e.target.value)}
                    placeholder={t('输入凭据（保存后立即验证，不回显）')}
                    required
                  />
                </label>
                <div className="connection-actions">
                  <Button type="submit" size="sm" disabled={busy || !credValue.trim()}>
                    {t('保存并验证')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setCredTarget(null)
                      setCredValue('')
                    }}
                  >
                    {t('取消')}
                  </Button>
                </div>
              </form>
            )}
          </article>
        ))}
      </section>
    </div>
  )
}
