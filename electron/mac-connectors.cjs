const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execute = promisify(execFile)
const catalog = [
  { id: 'mac_finder_selection', name: 'Finder 访达', description: '查看访达中当前选中项目的名称和类型，最多 20 项。' },
  { id: 'mac_notes_create', name: '备忘录', description: '将标题和正文存为新备忘录，保存在默认账户的默认文件夹。' },
  { id: 'mac_music_control', name: '音乐', description: '查看当前歌曲和歌手，暂停、继续或切换当前播放队列中的歌曲。' },
  { id: 'mac_speak', name: '系统朗读', description: '用 Mac 的系统语音朗读一段短文本。' },
]

function macConnectors(enabled = [], { includeUnsupported = false } = {}) {
  const supported = process.platform === 'darwin'
  if (!supported && !includeUnsupported) return []
  const enabledIds = supported && Array.isArray(enabled) ? enabled : []
  return catalog.map(row => ({ ...row, enabled: enabledIds.includes(row.id) }))
}

function validText(value, max) {
  return typeof value === 'string' && !!value.trim() && !value.includes('\0') && [...value].length <= max
}

function validArgs(tool, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false
  const keys = Object.keys(args)
  switch (tool) {
    case 'mac_finder_selection': return keys.length === 0
    case 'mac_notes_create':
      return keys.length === 2 && validText(args.title, 120) && validText(args.body, 2000)
    case 'mac_music_control':
      return keys.length === 1 && ['status', 'pause', 'resume', 'next', 'previous'].includes(args.action)
    case 'mac_speak': return keys.length === 1 && validText(args.text, 200)
    default: return false
  }
}

function failed(stderr, status = 'failed') {
  return { status, stderr, stdout: '', exit_code: null, truncated: false }
}

let script
async function runMacTool(call, signal) {
  if (process.platform !== 'darwin') return failed('此连接器仅适用于 macOS')
  if (!validArgs(call.tool, call.arguments) || !Number.isInteger(call.timeout_seconds) ||
      call.timeout_seconds < 1 || call.timeout_seconds > 120) return failed('无效的 Mac 连接器参数')
  if (signal.aborted) return failed('连接器已关闭')
  const deadline = AbortSignal.timeout(call.timeout_seconds * 1000)
  try {
    // osascript cannot read files inside an Electron ASAR. Only this bundled source is executable.
    script ??= fs.readFileSync(path.join(__dirname, 'mac-automation.js'), 'utf8')
    const { stdout } = await execute('/usr/bin/osascript', [
      '-l', 'JavaScript', '-e', script, JSON.stringify({ tool: call.tool, args: call.arguments }),
    ], { signal: AbortSignal.any([signal, deadline]), killSignal: 'SIGKILL', maxBuffer: 65536 })
    const result = JSON.parse(stdout)
    let output = JSON.stringify(result)
    while (Buffer.byteLength(output) > 8192 && result.items?.length) {
      result.items.pop()
      result.truncated = true
      output = JSON.stringify(result)
    }
    if (Buffer.byteLength(output) > 8192) return failed('Mac 应用返回的数据过长')
    return { status: 'succeeded', stdout: output, stderr: '', exit_code: 0, truncated: !!result.truncated }
  } catch (error) {
    if (signal.aborted) return failed('连接器已关闭')
    if (deadline.aborted) return failed('Mac 应用响应超时', 'timed_out')
    if (/-1743|-1744|-10004/.test(error.stderr || ''))
      return failed('自动化权限未获准，请在 Mac 的「系统设置 → 隐私与安全性 → 自动化」中允许 Purin 控制对应应用。')
    if (call.tool === 'mac_music_control') return failed('音乐未能完成操作，请在 Mac 的「音乐」中确认播放队列。')
    if (call.tool === 'mac_notes_create') return failed('无法创建备忘录，请检查默认账户和自动化权限。')
    return failed('Mac 应用未能完成操作，请检查本机应用和权限。')
  }
}

module.exports = { macConnectors, runMacTool }
