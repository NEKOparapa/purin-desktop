const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { powerMonitor } = require('electron')
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
`

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

async function sampleActivity(withTarget = false) {
  const state = powerMonitor.getSystemIdleState(60)
  const value = { activity: state }
  if (state !== 'active') return value
  let executable, args
  if (process.platform === 'win32') {
    executable = 'powershell.exe'
    args = [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(windowsProbe, 'utf16le').toString('base64'),
    ]
  } else if (process.platform === 'darwin') {
    executable = '/usr/bin/osascript'
    args = [
      '-l',
      'JavaScript',
      '-e',
      macProbe + (withTarget ? macTarget : '') + '\nJSON.stringify(result)',
    ]
  } else {
    return value
  }
  try {
    const { stdout } = await run(executable, args, {
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    })
    const observation = JSON.parse(stdout)
    const clean = (text, limit) =>
      typeof text === 'string'
        ? Array.from(text.replace(/[\p{Cc}\p{Cs}\s]+/gu, ' ').trim())
            .slice(0, limit)
            .join('')
        : ''
    const app = clean(observation.foreground_app, 256)
    if (app) value.foreground_app = app
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
  } catch {
    /* Activity remains available if the frontmost app cannot be read. */
  }
  return value
}
module.exports = { sampleActivity }
