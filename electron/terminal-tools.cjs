const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')

const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
const binaries = process.platform === 'win32'
  ? { powershell: path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), cmd: path.join(system32, 'cmd.exe') }
  : { sh: '/bin/sh' }
const maxOutput = 8192

function availableTools() {
  return Object.entries(binaries).filter(([, file]) => {
    try { fs.accessSync(file, fs.constants.X_OK); return true } catch { return false }
  }).map(([name]) => name)
}

function secureTransport(address) {
  const { protocol, hostname } = new URL(address)
  return protocol === 'https:' || (protocol === 'http:' &&
    (hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname)))
}

function failed(stderr) {
  return { status: 'failed', stdout: '', stderr, exit_code: null, truncated: false }
}

function outputBuffer() {
  const buffer = Buffer.alloc(maxOutput)
  let used = 0, truncated = false
  return {
    write(chunk) {
      const n = chunk.copy(buffer, used, 0, maxOutput - used)
      used += n
      if (n < chunk.length) truncated = true
    },
    get truncated() { return truncated },
    text() {
      // Drop terminal control bytes and bound the UTF-8 result even for binary output.
      // oxlint-disable-next-line no-control-regex
      const value = buffer.subarray(0, used).toString('utf8').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      const utf8 = Buffer.from(value)
      if (utf8.length > maxOutput) truncated = true
      return new TextDecoder().decode(utf8.subarray(0, maxOutput), { stream: truncated })
    },
  }
}

function killTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    execFile(path.join(system32, 'taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'],
      { windowsHide: true, timeout: 3000 }, error => { if (error) child.kill() })
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  }
}

function runCommand(call, signal) {
  const { tool, arguments: args, timeout_seconds: seconds } = call
  if (!Object.hasOwn(binaries, tool)) return failed('本机未提供该工具')
  if (typeof args?.command !== 'string' || !args.command.trim() ||
      Buffer.byteLength(args.command) > 8192 || args.command.includes('\0') ||
      !Number.isInteger(seconds) || seconds < 1 || seconds > 120) return failed('命令或超时时间无效')
  if (signal.aborted) return failed('远程执行已关闭')
  const command = args.command
  let argv
  if (tool === 'powershell') {
    const source = "$ProgressPreference = 'SilentlyContinue'\n[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n" + command
    argv = ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')]
  } else if (tool === 'cmd') {
    argv = ['/d', '/s', '/c', '"chcp 65001>nul & ' + command + '"']
  } else {
    argv = ['-c', command]
  }
  return new Promise(resolve => {
    const stdout = outputBuffer(), stderr = outputBuffer()
    const child = spawn(binaries[tool], argv, {
      cwd: os.homedir(), windowsHide: true, windowsVerbatimArguments: tool === 'cmd',
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stopped, fallback, finished = false
    const abort = () => stop('failed')
    const timer = setTimeout(() => stop('timed_out'), seconds * 1000)
    function stop(status) {
      if (stopped || finished) return
      stopped = status
      killTree(child)
      // An uncooperative descendant can inherit the pipes after the shell exits.
      fallback = setTimeout(() => finish(null), 3500)
    }
    function finish(code, error) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      clearTimeout(fallback)
      signal.removeEventListener('abort', abort)
      child.stdout.destroy()
      child.stderr.destroy()
      resolve({
        status: stopped || (code === 0 ? 'succeeded' : 'failed'),
        stdout: stdout.text(),
        stderr: error?.message || stderr.text() || (stopped === 'failed' ? '远程执行已关闭' : ''),
        exit_code: stopped ? null : code,
        truncated: stdout.truncated || stderr.truncated,
      })
    }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', chunk => stdout.write(chunk))
    child.stderr.on('data', chunk => stderr.write(chunk))
    child.on('error', error => finish(null, error))
    child.on('close', code => finish(code))
  })
}

// The journal belongs to one authenticated connection. At most one call is in flight.
class TerminalToolClient {
  constructor({ file, enabled, tools, extraTools = [], handlers = {}, post, save, read, onIssue }) {
    Object.assign(this, { file, enabled, tools, extraTools, handlers, post, save, onIssue })
    this.journal = read(file, {})
    this.epoch = 0
    this.issue = ''
  }

  activeTools() {
    const list = this.enabled ? [...this.tools] : []
    for (const name of this.extraTools || []) {
      if (!list.includes(name)) list.push(name)
    }
    return list
  }

  updateIssue(message) {
    if (this.closed || this.issue === message) return
    this.issue = message
    this.onIssue()
  }

  setEnabled(enabled) {
    this.enabled = enabled
    this.epoch++
    if (!enabled) this.running?.abort()
    this.journal.withdraw = this.activeTools().length === 0
    this.save(this.file, this.journal)
    void this.poll()
  }

  setExtraTools(extraTools, handlers = {}) {
    this.extraTools = [...extraTools]
    this.handlers = { ...handlers }
    this.epoch++
    this.journal.withdraw = this.activeTools().length === 0
    this.save(this.file, this.journal)
    void this.poll()
  }

  close() {
    this.closed = true
    this.running?.abort()
  }

  async poll() {
    const active = this.activeTools()
    if (this.closed || this.busy || (!active.length && !this.journal.pending && !this.journal.withdraw)) return
    this.busy = true
    try {
      await this.flushResult()
      if (this.closed) return
      const epoch = this.epoch
      const advertised = this.activeTools()
      const { call } = await this.post('/v1/terminal-tools/claim', { tools: advertised })
      if (this.closed) return
      if (!advertised.length && epoch === this.epoch && this.journal.withdraw) {
        delete this.journal.withdraw
        this.save(this.file, this.journal)
      }
      if (call != null) {
        if (typeof call.id !== 'string' || !call.id || typeof call.claim_token !== 'string' || !call.claim_token)
          throw new Error('服务端返回了无效的工具调用')
        const pending = { id: call.id, body: { claim_token: call.claim_token,
          ...failed('执行过程被中断，结果未知。') } }
        this.journal.pending = pending
        // Commit the claim before starting the process. A restart delivers this failure or
        // the completed result below; it never starts the same command again.
        this.save(this.file, this.journal)
        this.running = new AbortController()
        let result
        const handler = this.handlers?.[call.tool]
        if (handler) {
          result = this.epoch !== epoch
            ? failed('连接器状态已变更')
            : await handler(call, this.running.signal)
        } else {
          result = !this.enabled || this.epoch !== epoch
            ? failed('远程执行已关闭')
            : await runCommand(call, this.running.signal)
        }
        if (this.closed) return
        Object.assign(pending.body, result)
        this.save(this.file, this.journal)
        await this.flushResult()
      }
      this.updateIssue('')
    } catch (error) {
      this.updateIssue(error.message || '终端工具连接失败')
    } finally {
      this.running = null
      this.busy = false
    }
  }

  async flushResult() {
    const item = this.journal.pending
    if (!item) return
    try {
      await this.post('/v1/terminal-tools/' + encodeURIComponent(item.id) + '/result', item.body)
    } catch (error) {
      if (![404, 409, 410].includes(error.status)) throw error
    }
    if (this.closed) return
    delete this.journal.pending
    this.save(this.file, this.journal)
  }
}

module.exports = { availableTools, secureTransport, runCommand, TerminalToolClient }
