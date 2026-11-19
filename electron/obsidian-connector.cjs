const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const MAX_OUTPUT_BYTES = 8192
const IGNORED_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules'])

function obsidianConfigPath() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, 'obsidian', 'obsidian.json')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json')
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(xdg, 'obsidian', 'obsidian.json')
}

function detectObsidianVaults() {
  const file = obsidianConfigPath()
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const vaults = raw && typeof raw.vaults === 'object' && raw.vaults ? raw.vaults : {}
    const items = []
    for (const [id, entry] of Object.entries(vaults)) {
      if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) continue
      const vaultPath = path.resolve(entry.path)
      try {
        if (!fs.statSync(vaultPath).isDirectory()) continue
      } catch {
        continue
      }
      items.push({
        id,
        name: path.basename(vaultPath) || vaultPath,
        path: vaultPath,
        open: entry.open === true,
        ts: typeof entry.ts === 'number' ? entry.ts : 0,
      })
    }
    items.sort((a, b) => Number(b.open) - Number(a.open) || b.ts - a.ts)
    return items.map(({ id, name, path: p, open }) => ({ id, name, path: p, open }))
  } catch {
    return []
  }
}

function walkMarkdownFiles(rootDir, baseDir, results, limit) {
  let entries
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (results.length >= limit) return
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      walkMarkdownFiles(rootDir, path.join(baseDir, entry.name), results, limit)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const fullPath = path.join(baseDir, entry.name)
      const rel = path.relative(rootDir, fullPath).split(path.sep).join('/')
      let mtimeMs = 0
      try {
        mtimeMs = fs.statSync(fullPath).mtimeMs
      } catch {
        /* ignore */
      }
      results.push({ path: rel, fullPath, mtimeMs })
    }
  }
}

function inspectVault(vaultPath) {
  if (typeof vaultPath !== 'string' || !vaultPath.trim()) {
    return { valid: false, path: '', name: '', hasObsidianDir: false, noteCount: 0 }
  }
  const resolved = path.resolve(vaultPath.trim())
  let stat
  try {
    stat = fs.statSync(resolved)
  } catch {
    return { valid: false, path: resolved, name: path.basename(resolved), hasObsidianDir: false, noteCount: 0 }
  }
  if (!stat.isDirectory()) {
    return { valid: false, path: resolved, name: path.basename(resolved), hasObsidianDir: false, noteCount: 0 }
  }
  let hasObsidianDir = false
  try {
    hasObsidianDir = fs.statSync(path.join(resolved, '.obsidian')).isDirectory()
  } catch {
    /* optional */
  }
  const files = []
  walkMarkdownFiles(resolved, resolved, files, 5000)
  return {
    valid: true,
    path: resolved,
    name: path.basename(resolved) || resolved,
    hasObsidianDir,
    noteCount: files.length,
  }
}

function resolveInsideVault(vaultRoot, relativePath, { requireMarkdown = true } = {}) {
  if (typeof relativePath !== 'string' || !relativePath.trim() || relativePath.includes('\0')) {
    throw new Error('路径无效')
  }
  let normalized = relativePath.trim().replaceAll('\\', '/').replace(/^\/+/, '')
  if (requireMarkdown && !normalized.toLowerCase().endsWith('.md')) {
    normalized += '.md'
  }
  const resolvedRoot = path.resolve(vaultRoot)
  const target = path.resolve(resolvedRoot, normalized)
  const rel = path.relative(resolvedRoot, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径超出了 Obsidian Vault 范围')
  }
  const segments = rel.split(path.sep)
  if (segments.some((seg) => IGNORED_DIRS.has(seg) || seg.startsWith('.'))) {
    throw new Error('不允许访问隐藏目录或 .obsidian 配置目录')
  }
  // Lexical containment alone allows a directory link to redirect reads and writes
  // outside the vault. Check existing parents and the target without following links.
  let current = resolvedRoot
  for (const segment of segments) {
    current = path.join(current, segment)
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error('不允许通过符号链接或目录联接访问笔记')
      }
    } catch (error) {
      if (error.code === 'ENOENT') break
      throw error
    }
  }
  return { target, rel: segments.join('/') }
}

function fitJsonResult(payload) {
  let text = JSON.stringify(payload)
  if (Buffer.byteLength(text, 'utf8') <= MAX_OUTPUT_BYTES) {
    return { status: 'succeeded', stdout: text, stderr: '', exit_code: 0, truncated: false }
  }
  const utf8 = Buffer.from(text, 'utf8')
  const sliced = new TextDecoder().decode(utf8.subarray(0, MAX_OUTPUT_BYTES), { stream: true })
  return { status: 'succeeded', stdout: sliced, stderr: '', exit_code: 0, truncated: true }
}

function fail(message) {
  return { status: 'failed', stdout: '', stderr: String(message || 'Obsidian 操作失败'), exit_code: 1, truncated: false }
}

function runObsidianTool(vaultPath, args) {
  const info = inspectVault(vaultPath)
  if (!info.valid) return fail('Obsidian Vault 未配置或目录不存在')
  if (!args || typeof args !== 'object') return fail('obsidian 工具需要传入 arguments 对象')

  const action = args.action
  try {
    if (action === 'vault_info') {
      const topFolders = fs
        .readdirSync(info.path, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.'))
        .map((e) => e.name)
        .slice(0, 50)
      return fitJsonResult({
        vault: info.name,
        noteCount: info.noteCount,
        hasObsidianDir: info.hasObsidianDir,
        folders: topFolders,
      })
    }

    if (action === 'list_notes') {
      const limit = Math.max(1, Math.min(Number(args.limit) || 50, 100))
      let searchRoot = info.path
      if (typeof args.folder === 'string' && args.folder.trim()) {
        const resolved = resolveInsideVault(info.path, args.folder, { requireMarkdown: false })
        searchRoot = resolved.target
      }
      const files = []
      walkMarkdownFiles(info.path, searchRoot, files, 2000)
      files.sort((a, b) => b.mtimeMs - a.mtimeMs)
      return fitJsonResult({
        vault: info.name,
        total: files.length,
        notes: files.slice(0, limit).map((f) => ({
          path: f.path,
          updatedAt: new Date(f.mtimeMs).toISOString(),
        })),
      })
    }

    if (action === 'read_note') {
      const { target, rel } = resolveInsideVault(info.path, args.path)
      const content = fs.readFileSync(target, 'utf8')
      const offset = Math.max(0, Number(args.offset) || 0)
      const maxChars = Math.max(200, Math.min(Number(args.max_chars) || 4000, 5500))
      const slice = content.slice(offset, offset + maxChars)
      return fitJsonResult({
        path: rel,
        totalChars: content.length,
        offset,
        nextOffset: offset + slice.length < content.length ? offset + slice.length : null,
        content: slice,
      })
    }

    if (action === 'search_notes') {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) return fail('search_notes 需要提供非空 query')
      const needle = query.toLowerCase()
      const limit = Math.max(1, Math.min(Number(args.limit) || 15, 30))
      const files = []
      walkMarkdownFiles(info.path, info.path, files, 2000)
      files.sort((a, b) => b.mtimeMs - a.mtimeMs)
      const matches = []
      for (const file of files) {
        if (matches.length >= limit) break
        const nameMatch = file.path.toLowerCase().includes(needle)
        let matchedLine = null
        let snippet = ''
        try {
          const text = fs.readFileSync(file.fullPath, 'utf8')
          const lines = text.split(/\r?\n/)
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(needle)) {
              matchedLine = i + 1
              snippet = lines[i].trim().slice(0, 180)
              break
            }
          }
        } catch {
          continue
        }
        if (nameMatch || matchedLine !== null) {
          matches.push({ path: file.path, line: matchedLine, snippet })
        }
      }
      return fitJsonResult({ query, matches })
    }

    if (action === 'write_note') {
      if (typeof args.content !== 'string') return fail('write_note 需要字符串 content')
      const { target, rel } = resolveInsideVault(info.path, args.path)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, args.content, 'utf8')
      return fitJsonResult({ path: rel, writtenBytes: Buffer.byteLength(args.content, 'utf8') })
    }

    if (action === 'append_note') {
      if (typeof args.content !== 'string') return fail('append_note 需要字符串 content')
      const { target, rel } = resolveInsideVault(info.path, args.path)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      const prefix = fs.existsSync(target) ? '\n' : ''
      fs.appendFileSync(target, prefix + args.content, 'utf8')
      return fitJsonResult({ path: rel, appendedBytes: Buffer.byteLength(args.content, 'utf8') })
    }

    return fail(
      '不支持的 obsidian action，可选：vault_info、list_notes、read_note、search_notes、write_note、append_note',
    )
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Obsidian 操作失败')
  }
}

module.exports = {
  detectObsidianVaults,
  inspectVault,
  runObsidianTool,
}
