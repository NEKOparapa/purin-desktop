import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
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
  revision,
}: {
  configured: boolean
  revision?: number
}) {
  const api = window.wintermute
  if (!api)
    return (
      <p className="settings-note">
        请打开 Wintermute 桌面应用以管理后端接口密钥。
      </p>
    )
  if (!configured)
    return (
      <p className="settings-note">
        请先在「连接」中连接后端，再管理接口密钥。
      </p>
    )
  if (!api.apiKeys || !api.updateApiKey || revision === undefined) {
    return <p className="settings-note">请更新桌面客户端以管理接口密钥。</p>
  }
  return <ConnectedKeys api={api} revision={revision} />
}

function ConnectedKeys({ api, revision }: { api: KeysApi; revision: number }) {
  const [attempt, setAttempt] = useState(0)
  const [items, setItems] = useState<ApiKeySetting[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const candidate = draft.trim()
  const valid = /^[!-~]{1,4096}$/.test(candidate)

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
    setFeedback('')
    setEditing(id)
  }

  async function save(item: ApiKeySetting) {
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
      setFeedback(`${item.usages.join('、')}的密钥已保存。`)
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
    <section className="api-key-settings" aria-label="后端接口密钥">
      <header>
        <p className="settings-note">
          已保存的密钥只显示掩码。更换后，同组列出的用途会一起使用新密钥。
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={saving || editing !== null || (!items && !error)}
        >
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
      {items?.map((item) => (
        <section
          key={item.id}
          className="api-key-row"
          aria-label={item.usages.join('、')}
        >
          <div className="api-key-summary">
            <div>
              <h3>{item.usages.join('、')}</h3>
              <p>
                {item.configured ? (
                  <>已配置 {item.masked && <code>{item.masked}</code>}</>
                ) : (
                  '未配置'
                )}
              </p>
            </div>
            {editing !== item.id && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={editing !== null}
                onClick={() => edit(item.id)}
              >
                {item.configured ? '更换' : '设置'}
              </Button>
            )}
          </div>
          {editing === item.id && (
            <form
              className="connection-form"
              onSubmit={(event) => {
                event.preventDefault()
                void save(item)
              }}
            >
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
                <Button type="submit" size="sm" disabled={saving || !valid}>
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
        </section>
      ))}
      {feedback && (
        <p className="source-feedback" role="status">
          {feedback}
        </p>
      )}
    </section>
  )
}
