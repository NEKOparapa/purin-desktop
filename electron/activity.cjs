const { execFile, spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const { promisify } = require('node:util')
const { powerMonitor } = require('electron')
const {
  sampleWindowsFocusedInput,
  macInputScript,
  isMacAccessibilityGranted,
} = require('./text-input-probe.cjs')
const run = promisify(execFile)

const windowsProbe = `
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -Name Foreground -Namespace Wintermute -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern uint GetWindowThreadProcessId(System.IntPtr window, out uint processId);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
public static extern int GetWindowTextW(System.IntPtr window, System.Text.StringBuilder title, int capacity);
'@
function Read-Foreground {
[uint32]$foregroundPid = 0
$window = [Wintermute.Foreground]::GetForegroundWindow()
[void][Wintermute.Foreground]::GetWindowThreadProcessId($window, [ref]$foregroundPid)
if ($foregroundPid) {
  $result = @{ foreground_app = [Diagnostics.Process]::GetProcessById($foregroundPid).ProcessName; pid = $foregroundPid; handle = $window.ToInt64().ToString() }
  $title = New-Object System.Text.StringBuilder 513
  if ([Wintermute.Foreground]::GetWindowTextW($window, $title, $title.Capacity) -gt 0) {
    $result.window_title = $title.ToString()
  }
  ConvertTo-Json -InputObject $result -Compress
}
}
`

// Keep the native declarations loaded between one-second title checks. The
// helper only reads a window when asked and exits when the pipe closes.
let probeProcess
let outstanding
let idleTimer
function windowsObservation() {
  clearTimeout(idleTimer)
  if (outstanding) return outstanding.promise
  if (!probeProcess) {
    const script = windowsProbe + `
while ($null -ne [Console]::ReadLine()) {
  try { $line = Read-Foreground; [Console]::WriteLine([string]$line) }
  catch { [Console]::WriteLine('{}') }
}
`
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    probeProcess = child
    const stop = () => {
      if (probeProcess !== child) return
      probeProcess = undefined
      outstanding?.finish('{}')
    }
    child.once('exit', stop)
    child.once('error', stop)
    child.stdin.on('error', stop)
    createInterface({ input: child.stdout }).on('line', line => {
      if (probeProcess === child) outstanding?.finish(line || '{}')
    })
  }
  const child = probeProcess
  let resolve
  const promise = new Promise(done => { resolve = done })
  const timeout = setTimeout(() => { child.kill() }, 5000)
  outstanding = { promise, finish(stdout) {
    clearTimeout(timeout)
    outstanding = undefined
    resolve({ stdout })
    idleTimer = setTimeout(() => {
      if (probeProcess === child) {
        probeProcess = undefined
        child.stdin.end()
      }
    }, 5000)
    idleTimer.unref()
  } }
  child.stdin.write('\n')
  return promise
}

const macProbe = `
ObjC.import('AppKit')
const app = $.NSWorkspace.sharedWorkspace.frontmostApplication
const result = { foreground_app: ObjC.unwrap(app.localizedName), pid: Number(app.processIdentifier) }
try {
  const process = Application('System Events').applicationProcesses.whose({ frontmost: true })[0]
  if (process.unixId() === Number(app.processIdentifier)) {
    result.window_title = process.windows[0].name()
  }
} catch (_) { /* The OS can withhold window metadata. */ }
`

// Window-server order is front to back. Only a visible normal window owned by
// the active process is eligible.
const macTarget = `
ObjC.import('CoreGraphics')
const windows = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(17, 0)) || []
const front = windows.find(w => w.kCGWindowLayer === 0 && w.kCGWindowAlpha > 0)
if (front && front.kCGWindowOwnerPID === result.pid) {
  result.handle = String(front.kCGWindowNumber)
  if (front.kCGWindowName) result.window_title = front.kCGWindowName
}
`

async function sampleActivity(options = false) {
  const withTarget = typeof options === 'boolean' ? options : Boolean(options?.withTarget)
  const withTextInput =
    typeof options === 'object' && options !== null && Boolean(options.withTextInput)
  // Keep checking for a locked session, but count foreground dwell without input.
  const state = powerMonitor.getSystemIdleState(1)
  const value = { activity: state === 'idle' ? 'active' : state }
  if (value.activity !== 'active') return value
  if (process.platform !== 'win32' && process.platform !== 'darwin') return value
  const macInputAllowed = withTextInput && process.platform === 'darwin'
    ? isMacAccessibilityGranted()
    : false
  if (withTextInput && process.platform === 'darwin' && !macInputAllowed) {
    value.input_issue = '请在 macOS 系统设置的“隐私与安全性 → 辅助功能”中允许 Wintermute'
  }
  try {
    const { stdout } = process.platform === 'win32'
      ? await windowsObservation()
      : await run('/usr/bin/osascript', [
          '-l', 'JavaScript', '-e',
          macProbe +
            (withTarget ? macTarget : '') +
            (macInputAllowed ? macInputScript(process.pid) : '') +
            '\nJSON.stringify(result)',
        ], { timeout: 5000, maxBuffer: 64 * 1024 })
    const observation = JSON.parse(stdout)
    const clean = (text, limit) =>
      typeof text === 'string'
        ? Array.from(text.replace(/[\p{Cc}\p{Cs}\s]+/gu, ' ').trim())
            .slice(0, limit)
            .join('')
        : ''
    const app = clean(observation.foreground_app, 256)
    if (app) value.foreground_app = app
    if (Number.isInteger(observation.pid) && observation.pid > 0) {
      value.pid = observation.pid
    }
    if (
      withTarget &&
      observation.pid > 0 &&
      observation.pid !== process.pid &&
      /^[1-9]\d*$/.test(observation.handle)
    ) {
      value.target = {
        id: observation.handle,
        pid: observation.pid,
        platform: process.platform === 'darwin' ? 'macos' : 'windows',
      }
    }
    if (typeof observation.window_title === 'string') {
      const title = clean(observation.window_title, 512)
      if (title) value.window_title = title
    }
    if (withTextInput) {
      if (process.platform === 'win32' && observation.pid > 0 && observation.pid !== process.pid) {
        try {
          const input = await sampleWindowsFocusedInput(observation.pid, app)
          if (input) value.input = input
        } catch {
          /* Text input sampling failure must not interrupt window tracking. */
        }
      } else if (process.platform === 'darwin' && observation.input && typeof observation.input === 'object') {
        value.input = observation.input
      }
    }
  } catch {
    /* Activity remains available if the frontmost app cannot be read. */
  }
  return value
}
module.exports = { sampleActivity }
