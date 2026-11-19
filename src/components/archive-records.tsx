import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, FileText, Folder, RotateCw, Search } from 'lucide-react'
import remarkGfm from 'remark-gfm'
import type { MemoryDocument, MemoryFile } from '@/lib/desktop'
import { memoryError } from '@/lib/memory-error'
import './archive-records.css'

const Markdown = lazy(() => import('react-markdown'))

interface Directory {
  path: string
  name: string
  directories: Directory[]
  files: MemoryFile[]
}
const folderLabels: Record<string, string> = {
  'agent-character': '角色设定', 'about-user': '用户画像', note: '笔记', log: '变更日志',
}

function directoryTree(files: MemoryFile[]): Directory {
  const root: Directory = { path: '', name: '', directories: [], files: [] }
  for (const file of files) {
    let parent = root
    for (const name of file.path.split('/').slice(0, -1)) {
      let child = parent.directories.find(dir => dir.name === name)
      if (!child) {
        child = { path: [parent.path, name].filter(Boolean).join('/'), name, directories: [], files: [] }
        parent.directories.push(child)
      }
      parent = child
    }
    parent.files.push(file)
  }
  return root
}

function FileTree({ directory, selected, select }: {
  directory: Directory; selected: string; select: (path: string) => void
}) {
  return <ul>
    {directory.directories.map(dir => <li key={dir.path}>
      <details open>
        <summary><Folder size={14} aria-hidden="true" />
          <span>{folderLabels[dir.path] ? `${folderLabels[dir.path]} · ${dir.name}` : dir.name}</span>
        </summary>
        <FileTree directory={dir} selected={selected} select={select} />
      </details>
    </li>)}
    {directory.files.map(file => <li key={file.path}>
      <button aria-current={file.path === selected ? 'page' : undefined}
        title={[file.path, file.title, file.summary].filter(Boolean).join('\n')}
        onClick={() => select(file.path)}>
        <FileText size={14} aria-hidden="true" />
        <span>{file.path.split('/').at(-1)}{file.title && <small>{file.title}</small>}</span>
      </button>
    </li>)}
  </ul>
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function ArchiveDocument({ file, revision, paths, select }: {
  file: MemoryFile; revision: number; paths: Set<string>; select: (path: string) => void
}) {
  const [document, setDocument] = useState<MemoryDocument | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [retry, setRetry] = useState(0)
  const [source, setSource] = useState(false)
  const [limit, setLimit] = useState(32000)
  useEffect(() => {
    let live = true
    async function read() {
      if (!live) return
      setBusy(true)
      setError('')
      try {
        if (!window.wintermute) throw new Error('请在桌面端中读取档案')
        const value = await window.wintermute.memoryFile(file.path)
        if (live) setDocument(value)
      } catch (e) {
        if (live) setError(memoryError(e))
      } finally {
        if (live) setBusy(false)
      }
    }
    queueMicrotask(() => { void read() })
    return () => { live = false }
  }, [file.path, revision, retry])
  const content = document?.content ?? ''
  const visible = content.slice(0, limit)
  // Keep frontmatter readable without interpreting it as a heading or an HTML block.
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(visible)
  function linkedPath(href?: string) {
    if (!href || /^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) return null
    try {
      const url = new URL(href, 'https://memory.invalid/' + file.path)
      const path = decodeURIComponent(url.pathname.slice(1))
      return paths.has(path) ? path : null
    } catch { return null }
  }
  return <article className="archive-document" aria-label={file.path}>
    <header className="archive-document-heading">
      <div>
        <h2>{file.title || file.path.split('/').at(-1)}</h2>
        <p className="archive-path">{file.path}</p>
        <p className="archive-meta">{formatBytes(file.bytes)} · 更新于 <time dateTime={file.updated_at}>{new Date(file.updated_at).toLocaleString('zh-CN')}</time></p>
      </div>
      <div className="archive-mode" role="group" aria-label="档案显示方式">
        <button aria-pressed={!source} onClick={() => setSource(false)}>预览</button>
        <button aria-pressed={source} onClick={() => setSource(true)}>原文</button>
      </div>
    </header>
    {busy && <p className="archive-meta" role="status">正在读取档案…</p>}
    {error && <div className="history-error" role="alert">
      <p>{error}</p><button className="history-refresh" onClick={() => setRetry(retry + 1)}>重试读取</button>
    </div>}
    {document && (content ? source ? <pre className="archive-source">{visible}</pre> :
      <div className="archive-markdown">
        {frontmatter && <details className="archive-frontmatter"><summary>文件属性</summary><pre>{frontmatter[1]}</pre></details>}
        <Suspense fallback={<p role="status">正在加载 Markdown 预览…</p>}>
        <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
          a: ({ href, children }) => {
            const path = linkedPath(href)
            return path ? <button className="archive-link" onClick={() => select(path)}>{children}</button> :
              <span className="archive-reference" title={href}>{children}{href && <small>（{href}）</small>}</span>
          },
          img: ({ alt }) => <span className="archive-image">[图片：{alt || '未命名'}]</span>,
        }}>{frontmatter ? visible.slice(frontmatter[0].length) : visible}</Markdown>
        </Suspense>
      </div> : <p className="history-empty">这个 Markdown 文件尚无内容。</p>)}
    {content.length > limit && <div className="archive-more">
      <p>已显示 {limit.toLocaleString()} / {content.length.toLocaleString()} 字符</p>
      <button className="history-refresh" onClick={() => setLimit(limit + 32000)}>继续显示内容</button>
    </div>}
  </article>
}

export function ArchiveRecords() {
  const [files, setFiles] = useState<MemoryFile[]>([])
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const refresh = useRef<() => void>(() => {})
  useEffect(() => {
    let live = true, pending = false
    async function read() {
      if (pending || !live) return
      pending = true
      setBusy(true)
      setError('')
      try {
        if (!window.wintermute) throw new Error('请在桌面端中读取档案')
        const value = await window.wintermute.memoryTree()
        if (!live) return
        value.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true }))
        setFiles(value)
        setSelected(path => value.some(file => file.path === path) ? path :
          value.find(file => file.path === 'about-user/profile.md')?.path ?? value[0]?.path ?? '')
        setRevision(version => version + 1)
      } catch (e) {
        if (live) setError(memoryError(e))
      } finally {
        pending = false
        if (live) setBusy(false)
      }
    }
    function whenVisible() { if (document.visibilityState === 'visible') void read() }
    refresh.current = () => { void read() }
    void read()
    const timer = window.setInterval(whenVisible, 60000)
    window.addEventListener('focus', whenVisible)
    document.addEventListener('visibilitychange', whenVisible)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', whenVisible)
      document.removeEventListener('visibilitychange', whenVisible)
    }
  }, [])
  const term = query.trim().toLocaleLowerCase()
  const visible = useMemo(() => files.filter(file => !term || [file.path, file.title, file.summary]
    .some(value => value?.toLocaleLowerCase().includes(term))), [files, term])
  const tree = useMemo(() => directoryTree(visible), [visible])
  const paths = useMemo(() => new Set(files.map(file => file.path)), [files])
  const file = files.find(entry => entry.path === selected)
  return <section className="archive-records" aria-label="档案记录">
    <div className="history-tools archive-tools">
      <label className="history-search"><Search size={15} aria-hidden="true" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label="筛选 Markdown 文件" placeholder="搜索文件名、标题或摘要" />
      </label>
      <span className="archive-count">{term ? `${visible.length} / ` : ''}{files.length} 个 Markdown 文件</span>
      <button className="history-refresh" disabled={busy} onClick={() => refresh.current()}><RotateCw size={14} aria-hidden="true" />刷新</button>
    </div>
    {error && <p className="history-error history-status" role="alert">{error}</p>}
    {busy && !files.length && <p className="history-status" role="status">正在读取档案目录…</p>}
    {!busy && !error && !files.length && <div className="history-empty" role="status">
      <BookOpen size={22} aria-hidden="true" /><p>记忆目录中暂无 Markdown 文件</p>
    </div>}
    {files.length > 0 && <div className="archive-layout">
      <nav className="archive-files" aria-label="Markdown 文件目录">
        <p className="archive-directory-label">memory /</p>
        {visible.length ? <FileTree directory={tree} selected={selected} select={setSelected} /> :
          <p className="archive-meta">没有匹配的文件</p>}
      </nav>
      {file && <ArchiveDocument key={file.path} file={file} revision={revision} paths={paths} select={setSelected} />}
    </div>}
  </section>
}
