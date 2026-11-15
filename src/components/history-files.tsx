import { useState } from 'react'
import { FileDown } from 'lucide-react'
import type { HistoryFile } from '@/lib/desktop'

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message
    ? error.message.replace(/^.*?Error: /, '')
    : fallback
}

function DownloadFile({ file }: { file: HistoryFile }) {
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  async function download() {
    const api = window.wintermute
    if (busy || !api) return
    setBusy(true)
    setSaved(false)
    setError('')
    try {
      const result = await api.downloadHistoryFile({
        id: file.id,
        name: file.name,
      })
      setSaved(result.saved)
    } catch (e) {
      setError(message(e, '下载失败，请重试。'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <li>
      <button
        className="history-file"
        disabled={busy}
        onClick={download}
        title={'下载 ' + file.name}
      >
        <FileDown size={14} aria-hidden="true" />
        {file.name}
      </button>
      {(busy || saved) && (
        <small role="status">{busy ? '正在保存…' : '已保存'}</small>
      )}
      {error && (
        <small className="history-error" role="alert">
          {error}
        </small>
      )}
    </li>
  )
}

export function Files({ files }: { files: HistoryFile[] }) {
  if (!files.length) return null
  return (
    <ul className="history-files" aria-label="附件">
      {files.map((file) => (
        <DownloadFile key={file.id} file={file} />
      ))}
    </ul>
  )
}
