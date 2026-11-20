import { useEffect, useState } from 'react'
import { Eye, EyeOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ApiKeySetting } from '@/lib/desktop'
import './api-key-settings.css'

// Electron may wrap errors with the IPC channel name. Never render arbitrary
// exception text from a transport that carried a credential.
const messages = [
  '请先连接设备',
  '连接已更改，请重新打开接口密钥',
  '管理接口密钥需要 HTTPS 或本机连接',
  '设备令牌无效，请重新连接',
  '此设备没有管理接口密钥的权限',
  '当前后端不支持接口密钥管理，请更新后端',
  '密钥配置项已变更，请刷新',
  '请输入有效的接口密钥',
  '后端暂时无法读写接口密钥',
  '无法连接后端，请检查连接后重试',
  '后端返回的密钥设置格式无效',
] as const

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  return (
    messages.find((text) => message.endsWith(text)) ??
    '管理接口密钥失败，请刷新后重试'
  )
}

type KeysApi = Pick<
  NonNullable<Window['wintermute']>,
  'apiKeys' | 'updateApiKey'
>

export function ApiKeySettings({
  configured,
  editingConnection,
  revision,
}: {
  configured: boolean
  editingConnection: boolean
  revision?: number
}) {
  const api = window.wintermute
  if (
    typeof api?.apiKeys === 'function' &&
    typeof api.updateApiKey === 'function' &&
    configured &&
    !editingConnection &&
    revision !== undefined
  ) {
    return <ConnectedKeys api={api} revision={revision} />
  }
  const note = !api
    ? '请打开 Wintermute 桌面应用以管理后端接口密钥。'
    : !configured
      ? '连接后端后可查看各外部服务使用的密钥。'
      : editingConnection
        ? '保存或取消连接编辑后可管理接口密钥。'
        : '请更新桌面客户端以管理接口密钥。'
  return (
    <section
      className="api-key-settings"
      aria-labelledby="connection-api-keys-title"
    >
      <h4 id="connection-api-keys-title">接口密钥</h4>
      <p className="settings-note">{note}</p>
    </section>
  )
}

function ConnectedKeys({ api, revision }: { api: KeysApi; revision: number }) {
  const [attempt, setAttempt] = useState(0)
  const [items, setItems] = useState<ApiKeySetting[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedRow, setSavedRow] = useState<string | null>(null)
  const [error, setError] = useState('')
  const candidate = draft.trim()
  const valid = /^[!-~]{1,4096}$/.test(candidate)
  const services = (items ?? []).flatMap((item) => {
    const usages = [
      ...new Set(
        item.usages.flatMap((usage) =>
          usage === '网络搜索与网页读取' ? ['网络搜索', '网页读取'] : [usage],
        ),
      ),
    ]
    if (!usages.length) usages.push('未标注用途')
    const keyName = /^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(item.id)?.[1]
    return usages.map((usage) => ({
      item,
      usage,
      usages,
      keyName,
      key: JSON.stringify([item.id, usage]),
    }))
  })

  useEffect(() => {
    let current = true
    api.apiKeys().then(
      (next) => {
        if (current) setItems(next)
      },
      (err) => {
        if (current) setError(safeError(err))
      },
    )
    return () => {
      current = false
    }
  }, [api, attempt])

  function edit(id: string | null) {
    setDraft('')
    setVisible(false)
    setSavedRow(null)
    setEditing(id)
  }

  async function save(item: ApiKeySetting, key: string) {
    if (!valid || saving) return
    setSaving(true)
    setVisible(false)
    try {
      setItems(
        await api.updateApiKey({
          id: item.id,
          apiKey: candidate,
          connectionRevision: revision,
        }),
      )
      edit(null)
      setSavedRow(key)
    } catch (err) {
      edit(null)
      setItems(null)
      setError(safeError(err))
    } finally {
      setSaving(false)
    }
  }

  function refresh() {
    edit(null)
    setError('')
    setItems(null)
    setAttempt((n) => n + 1)
  }

  return (
    <section
      className="api-key-settings"
      aria-labelledby="connection-api-keys-title"
    >
      <header>
        <h4 id="connection-api-keys-title">接口密钥</h4>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={saving || editing !== null || (!items && !error)}
        >
          <RefreshCw size={14} aria-hidden="true" />
          刷新
        </Button>
      </header>
      {error && (
        <p className="issue" role="alert">
          {error}
        </p>
      )}
      {!error && !items && (
        <p className="settings-note" role="status">
          正在读取密钥设置…
        </p>
      )}
      {items?.length === 0 && (
        <p className="settings-note">后端没有可管理的接口密钥。</p>
      )}
      {services.length > 0 && (
        <div className="api-key-list">
          <div className="api-key-columns api-key-labels" aria-hidden="true">
            <span>外部服务</span>
            <span>使用的密钥</span>
          </div>
          <ul aria-label="各外部服务使用的接口密钥">
            {services.map(({ item, usage, usages, keyName, key }) => (
              <li key={key} className="api-key-row">
                <div className="api-key-columns api-key-summary">
                  <div className="api-key-service">
                    <h5>{usage}</h5>
                    {usages.length > 1 && (
                      <p title={usages.join('、')}>
                        {usages.length} 个用途共用
                      </p>
                    )}
                  </div>
                  <div className="api-key-credential">
                    {keyName ? <code>{keyName}</code> : <span>后端密钥</span>}
                    <p>
                      <span data-configured={item.configured}>
                        {item.configured ? '已配置' : '未配置'}
                      </span>
                      {item.masked && <code>{item.masked}</code>}
                    </p>
                  </div>
                  {editing !== key && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${item.configured ? '更换' : '设置'}「${usage}」的密钥`}
                      disabled={editing !== null}
                      onClick={() => edit(key)}
                    >
                      {item.configured ? '更换' : '设置'}
                    </Button>
                  )}
                </div>
                {editing === key && (
                  <form
                    className="connection-form api-key-editor"
                    aria-describedby={
                      usages.length > 1 ? 'shared-api-key' : undefined
                    }
                    onSubmit={(event) => {
                      event.preventDefault()
                      void save(item, key)
                    }}
                  >
                    {usages.length > 1 && (
                      <p id="shared-api-key" className="api-key-shared-note">
                        更换后，{usages.join('、')}将同时使用新密钥。
                      </p>
                    )}
                    <label>
                      新密钥
                      <input
                        autoFocus
                        type={visible ? 'text' : 'password'}
                        value={draft}
                        disabled={saving}
                        onChange={(event) => setDraft(event.target.value)}
                        autoComplete="off"
                        aria-invalid={!!candidate && !valid}
                        aria-describedby={
                          candidate && !valid ? 'invalid-api-key' : undefined
                        }
                        spellCheck={false}
                        autoCapitalize="none"
                        required
                      />
                    </label>
                    <Button
                      className="api-key-visibility"
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={visible ? '隐藏新密钥' : '显示新密钥'}
                      aria-pressed={visible}
                      disabled={saving}
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? <EyeOff /> : <Eye />}
                    </Button>
                    {!!candidate && !valid && (
                      <p id="invalid-api-key" className="api-key-validation">
                        请输入不含空格的接口密钥，最多 4096 个 ASCII 字符。
                      </p>
                    )}
                    <div className="connection-actions">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={saving || !valid}
                      >
                        {saving ? '保存中…' : '保存密钥'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={saving}
                        onClick={() => edit(null)}
                      >
                        取消
                      </Button>
                    </div>
                  </form>
                )}
                {savedRow === key && (
                  <p className="source-feedback api-key-feedback" role="status">
                    密钥已保存。
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
