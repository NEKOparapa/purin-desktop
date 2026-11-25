import { useContext, useEffect, useState } from 'react'
import './history-files.css'
import { FileDown } from 'lucide-react'
import type { HistoryFile } from '@/lib/desktop'

import { HistoryConnection, useNearViewport } from './history-viewport'

function VisibleScreenshot({
  file,
  revision,
  retry,
}: {
  file: HistoryFile
  revision: number
  retry: () => void
}) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let objectUrl = ''
    async function load() {
      if (!active) return
      try {
        const bytes = await window.purin!.previewHistoryImage({
          id: file.id,
          connectionRevision: revision,
        })
        if (!active) return
        objectUrl = URL.createObjectURL(
          new Blob([bytes], { type: 'image/jpeg' }),
        )
        setUrl(objectUrl)
      } catch {
        if (active) setError('截图读取失败')
      }
    }
    queueMicrotask(() => void load())
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file.id, revision])

  if (error)
    return (
      <div className="history-image-state" role="status">
        {error}
        <button className="history-inline" onClick={retry}>
          重新加载截图
        </button>
      </div>
    )
  return url ? (
    <img src={url} alt={file.name} onError={() => setError('截图无法显示')} />
  ) : (
    <span className="history-image-state">正在读取截图…</span>
  )
}

function Screenshot({ file }: { file: HistoryFile }) {
  const revision = useContext(HistoryConnection)
  const { element, near } = useNearViewport<HTMLElement>()
  const [attempt, setAttempt] = useState(0)
  return (
    <li className="history-screenshot">
      <figure ref={element}>
        <div className="history-image-surface">
          {near &&
          revision !== undefined &&
          window.purin?.previewHistoryImage ? (
            <VisibleScreenshot
              key={revision + ':' + attempt}
              file={file}
              revision={revision}
              retry={() => setAttempt((a) => a + 1)}
            />
          ) : (
            <span className="history-image-state">
              {near ? '请更新桌面客户端以预览截图' : '截图预览'}
            </span>
          )}
        </div>
        <figcaption>{file.name}</figcaption>
      </figure>
    </li>
  )
}

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
    const api = window.purin
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
      {files.map((file, index) =>
        file.content_type === 'image/jpeg' ||
        (!file.content_type && /\.jpe?g$/i.test(file.name)) ? (
          <Screenshot key={file.id + ':' + index} file={file} />
        ) : (
          <DownloadFile key={file.id + ':' + index} file={file} />
        ),
      )}
    </ul>
  )
}
