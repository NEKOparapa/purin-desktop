const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const run = promisify(execFile)

// Print the target window into its own bitmap. Occluding windows and other
// monitors never enter the image. Only numeric handles are accepted.
async function captureWindowsWindow(handle, pid) {
  if (!/^[1-9]\d*$/.test(handle) || !Number.isInteger(pid) || pid <= 0)
    throw new Error('前台窗口无效')
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -Name Capture -Namespace Wintermute -MemberDefinition @'
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct Rect { public int Left, Top, Right, Bottom; }
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetWindowRect(System.IntPtr hwnd, out Rect bounds);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern uint GetWindowThreadProcessId(System.IntPtr hwnd, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool PrintWindow(System.IntPtr hwnd, System.IntPtr hdc, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetWindowDisplayAffinity(System.IntPtr hwnd, out uint affinity);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr SetThreadDpiAwarenessContext(System.IntPtr context);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetWindowDpiAwarenessContext(System.IntPtr hwnd);
'@
$window = [IntPtr]([Int64]'${handle}')
[void][Wintermute.Capture]::SetThreadDpiAwarenessContext([Wintermute.Capture]::GetWindowDpiAwarenessContext($window))
[uint32]$owner = 0
[uint32]$affinity = 0
[void][Wintermute.Capture]::GetWindowThreadProcessId($window, [ref]$owner)
if ($owner -ne ${pid}) { exit 2 }
if ([Wintermute.Capture]::GetWindowDisplayAffinity($window,[ref]$affinity) -and $affinity -ne 0) { exit 2 }
$bounds = New-Object 'Wintermute.Capture+Rect'
if (-not [Wintermute.Capture]::GetWindowRect($window,[ref]$bounds)) { exit 2 }
$w = $bounds.Right - $bounds.Left
$h = $bounds.Bottom - $bounds.Top
if ($w -lt 1 -or $h -lt 1 -or [long]$w * $h -gt 34000000) { exit 2 }
$bitmap = [Drawing.Bitmap]::new($w,$h)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$dc = $graphics.GetHdc()
try { $ok = [Wintermute.Capture]::PrintWindow($window,$dc,2) } finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
if (-not $ok) { exit 2 }
$scale = [Math]::Min(1,1920 / [double]([Math]::Max($w,$h)))
$scaled = [Drawing.Bitmap]::new($bitmap,[Math]::Max(1,[int]($w*$scale)),[Math]::Max(1,[int]($h*$scale)))
$buffer = [IO.MemoryStream]::new()
$scaled.Save($buffer,[Drawing.Imaging.ImageFormat]::Jpeg)
if ($buffer.Length -gt 4194304) { exit 2 }
[Console]::Write([Convert]::ToBase64String($buffer.ToArray()))
`
  try {
    const { stdout } = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 6 * 1024 * 1024,
      },
    )
    return stdout
  } catch {
    throw new Error('前台窗口已变化、受保护或暂时无法截图')
  }
}

module.exports = { captureWindowsWindow }
