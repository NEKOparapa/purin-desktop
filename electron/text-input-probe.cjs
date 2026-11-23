'use strict'

const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const { MAX_INPUT_LENGTH } = require('./text-input-filter.cjs')

const windowsInputProbeScript = `
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes -TypeDefinition @'
using System;
using System.Text;
using System.Threading;
using System.Windows.Automation;

namespace Wintermute {
  public sealed class InputSnapshot {
    public bool Editable;
    public bool IsPassword;
    public bool TooLong;
    public string FieldId;
    public string Text;
    public string Hint;
  }

  public static class InputProbe {
    private const int MaxCodePoints = ${MAX_INPUT_LENGTH};
    private const int MaxUtf16Sample = MaxCodePoints * 2 + 8;

    private static readonly AutoResetEvent RequestReady = new AutoResetEvent(false);
    private static readonly AutoResetEvent ResponseReady = new AutoResetEvent(false);
    private static volatile int reqFgPid;
    private static volatile int reqSelfPid;
    private static volatile string reqFgApp;
    private static volatile InputSnapshot latestResult;
    private static volatile bool workerStarted;

    private static void EnsureWorker() {
      if (workerStarted) return;
      workerStarted = true;
      var thread = new Thread(WorkerLoop);
      thread.IsBackground = true;
      thread.SetApartmentState(ApartmentState.MTA);
      thread.Start();
    }

    private static void WorkerLoop() {
      while (RequestReady.WaitOne()) {
        try {
          latestResult = ReadOnce(reqFgPid, reqSelfPid, reqFgApp);
        } catch {
          latestResult = new InputSnapshot();
        }
        ResponseReady.Set();
      }
    }

    public static InputSnapshot Read(int fgPid, int selfPid, string fgApp, int timeoutMs, out bool timedOut) {
      EnsureWorker();
      reqFgPid = fgPid;
      reqSelfPid = selfPid;
      reqFgApp = fgApp ?? "";
      latestResult = null;
      RequestReady.Set();
      if (!ResponseReady.WaitOne(timeoutMs)) {
        timedOut = true;
        return new InputSnapshot();
      }
      timedOut = false;
      return latestResult ?? new InputSnapshot();
    }

    private static int CountCodePoints(string s) {
      if (string.IsNullOrEmpty(s)) return 0;
      int count = 0;
      for (int i = 0; i < s.Length; i++) {
        if (!char.IsLowSurrogate(s[i])) count++;
      }
      return count;
    }

    private static string CleanTrim(string s) {
      if (string.IsNullOrEmpty(s)) return "";
      return s.Replace("\\r\\n", "\\n").Replace('\\r', '\\n').Trim();
    }

    private static InputSnapshot ReadOnce(int fgPid, int selfPid, string fgApp) {
      var snap = new InputSnapshot();
      if (fgPid <= 0 || fgPid == selfPid) return snap;
      AutomationElement el = AutomationElement.FocusedElement;
      if (el == null) return snap;
      var cur = el.Current;
      int pid = cur.ProcessId;
      if (pid <= 0 || pid == selfPid) return snap;
      bool uwpHost = string.Equals(fgApp, "ApplicationFrameHost", StringComparison.OrdinalIgnoreCase);
      if (pid != fgPid && !uwpHost) return snap;
      if (cur.IsPassword) {
        snap.IsPassword = true;
        return snap;
      }
      if (!cur.IsEnabled) return snap;

      var control = cur.ControlType;
      object vpObj = null;
      bool hasValue = el.TryGetCurrentPattern(ValuePattern.Pattern, out vpObj);
      ValuePattern vp = hasValue ? (ValuePattern)vpObj : null;
      if (hasValue && vp.Current.IsReadOnly) return snap;

      object tpObj = null;
      bool hasText = el.TryGetCurrentPattern(TextPattern.Pattern, out tpObj);
      TextPattern tp = hasText ? (TextPattern)tpObj : null;

      bool editable = false;
      if (hasValue && !vp.Current.IsReadOnly) {
        editable = control == ControlType.Edit ||
                   control == ControlType.ComboBox ||
                   control == ControlType.Document ||
                   control == ControlType.Group;
      } else if (hasText) {
        object ro = null;
        try { ro = tp.DocumentRange.GetAttributeValue(TextPattern.IsReadOnlyAttribute); } catch {}
        if (ro is bool && (bool)ro) return snap;
        if (control == ControlType.Edit || control == ControlType.ComboBox) {
          editable = true;
        } else if (control == ControlType.Document || control == ControlType.Group) {
          editable = (ro is bool && !(bool)ro);
        }
      }
      if (!editable) return snap;

      snap.Editable = true;
      int[] rid = null;
      try { rid = el.GetRuntimeId(); } catch {}
      if (rid != null && rid.Length > 0) {
        var sb = new StringBuilder();
        sb.Append(pid).Append(':');
        for (int i = 0; i < rid.Length; i++) {
          if (i > 0) sb.Append('.');
          sb.Append(rid[i]);
        }
        snap.FieldId = sb.ToString();
      } else {
        snap.FieldId = pid + ":" + (control != null ? control.ProgrammaticName : "") + ":" +
                       (cur.AutomationId ?? "") + ":" + (cur.ClassName ?? "");
      }

      var hintSb = new StringBuilder();
      if (!string.IsNullOrWhiteSpace(cur.Name)) hintSb.Append(cur.Name.Trim());
      if (!string.IsNullOrWhiteSpace(cur.AutomationId)) {
        if (hintSb.Length > 0) hintSb.Append(' ');
        hintSb.Append(cur.AutomationId.Trim());
      }
      if (!string.IsNullOrWhiteSpace(cur.HelpText)) {
        if (hintSb.Length > 0) hintSb.Append(' ');
        hintSb.Append(cur.HelpText.Trim());
      }
      string hint = hintSb.ToString();
      snap.Hint = hint.Length > 200 ? hint.Substring(0, 200) : hint;

      string raw = null;
      if (hasText) {
        try { raw = tp.DocumentRange.GetText(MaxUtf16Sample); } catch {}
      }
      if (string.IsNullOrEmpty(raw) && hasValue) {
        try { raw = vp.Current.Value; } catch {}
      }
      string cleaned = CleanTrim(raw);
      if (CountCodePoints(cleaned) > MaxCodePoints) {
        snap.TooLong = true;
        return snap;
      }
      snap.Text = cleaned;
      return snap;
    }
  }
}
'@
while ($null -ne ($req = [Console]::ReadLine())) {
  try {
    $parts = $req -split "\\t", 3
    $fgPid = [int]$parts[0]
    $selfPid = [int]$parts[1]
    $fgApp = if ($parts.Length -ge 3) { $parts[2] } else { "" }
    $timedOut = $false
    $snap = [Wintermute.InputProbe]::Read($fgPid, $selfPid, $fgApp, 350, [ref]$timedOut)
    if ($timedOut) {
      [Console]::WriteLine('{}')
      break
    }
    $out = @{
      editable = [bool]$snap.Editable
      is_password = [bool]$snap.IsPassword
      too_long = [bool]$snap.TooLong
    }
    if ($snap.FieldId) { $out.field_id = $snap.FieldId }
    if ($null -ne $snap.Text) { $out.text = $snap.Text }
    if ($snap.Hint) { $out.hint = $snap.Hint }
    [Console]::WriteLine((ConvertTo-Json -InputObject $out -Compress))
  } catch {
    [Console]::WriteLine('{}')
  }
}
`

let inputProbeProcess
let inputOutstanding
let inputIdleTimer

function closeInputProbe() {
  clearTimeout(inputIdleTimer)
  inputIdleTimer = undefined
  if (inputProbeProcess) {
    const child = inputProbeProcess
    inputProbeProcess = undefined
    try {
      child.stdin.end()
    } catch {
      /* ignore */
    }
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }
  inputOutstanding?.finish(null)
}

function sampleWindowsFocusedInput(fgPid, fgApp = '', selfPid = process.pid) {
  if (process.platform !== 'win32') return Promise.resolve(null)
  if (!Number.isInteger(fgPid) || fgPid <= 0 || fgPid === selfPid) {
    return Promise.resolve(null)
  }
  clearTimeout(inputIdleTimer)
  if (inputOutstanding) return inputOutstanding.promise
  if (!inputProbeProcess) {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(windowsInputProbeScript, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    )
    inputProbeProcess = child
    const stop = () => {
      if (inputProbeProcess !== child) return
      inputProbeProcess = undefined
      inputOutstanding?.finish(null)
    }
    child.once('exit', stop)
    child.once('error', stop)
    child.stdin.on('error', stop)
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (inputProbeProcess !== child) return
      let parsed = null
      try {
        const obj = JSON.parse(line || '{}')
        if (obj && typeof obj === 'object' && ('editable' in obj || 'is_password' in obj)) {
          parsed = obj
        }
      } catch {
        parsed = null
      }
      inputOutstanding?.finish(parsed)
    })
  }
  const child = inputProbeProcess
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  const timeout = setTimeout(() => {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }, 5000)
  inputOutstanding = {
    promise,
    finish(result) {
      clearTimeout(timeout)
      inputOutstanding = undefined
      resolve(result)
      inputIdleTimer = setTimeout(() => {
        if (inputProbeProcess === child) {
          inputProbeProcess = undefined
          child.stdin.end()
        }
      }, 10_000)
      inputIdleTimer.unref()
    },
  }
  const safeApp = String(fgApp || '').replace(/[\r\n\t]+/g, ' ').slice(0, 128)
  child.stdin.write(`${fgPid}\t${selfPid}\t${safeApp}\n`)
  return promise
}

function macInputScript(selfPid = process.pid) {
  return `
try {
  if (result.pid > 0 && result.pid !== ${Number(selfPid) || 0}) {
    const se = Application('System Events')
    const proc = se.applicationProcesses.whose({ frontmost: true })[0]
    if (proc.unixId() === result.pid) {
      const focused = proc.attributes.byName('AXFocusedUIElement').value()
      if (focused) {
        const readAttr = (name) => {
          try { return focused.attributes.byName(name).value() } catch (_) { return null }
        }
        const role = String(readAttr('AXRole') || '')
        const subrole = String(readAttr('AXSubrole') || '')
        const isPassword = role === 'AXSecureTextField' || subrole === 'AXSecureTextField'
        let settable = false
        try { settable = Boolean(focused.attributes.byName('AXValue').settable()) } catch (_) {}
        const editableRole =
          role === 'AXTextField' ||
          role === 'AXTextArea' ||
          role === 'AXComboBox' ||
          role === 'AXSearchField' ||
          role === 'AXWebArea' ||
          role === 'AXGroup'
        if (isPassword) {
          result.input = { editable: false, is_password: true, too_long: false }
        } else if (settable && editableRole) {
          const hint = [
            readAttr('AXDescription'),
            readAttr('AXTitle'),
            readAttr('AXPlaceholderValue'),
            readAttr('AXIdentifier'),
          ]
            .filter((v) => typeof v === 'string' && v.trim())
            .join(' ')
            .slice(0, 200)
          const idAttr = readAttr('AXIdentifier')
          const titleAttr = readAttr('AXTitle')
          const descAttr = readAttr('AXDescription')
          const fieldId = [
            result.pid,
            role,
            subrole,
            typeof idAttr === 'string' ? idAttr : '',
            typeof titleAttr === 'string' ? titleAttr : '',
            typeof descAttr === 'string' ? descAttr : '',
          ].join(':')
          const count = readAttr('AXNumberOfCharacters')
          if (typeof count === 'number' && count > ${MAX_INPUT_LENGTH}) {
            result.input = {
              editable: true,
              is_password: false,
              too_long: true,
              field_id: fieldId,
              hint,
            }
          } else {
            const raw = readAttr('AXValue')
            if (typeof raw === 'string') {
              const cleaned = raw.replace(/\\r\\n?/g, '\\n').trim()
              if (Array.from(cleaned).length > ${MAX_INPUT_LENGTH}) {
                result.input = {
                  editable: true,
                  is_password: false,
                  too_long: true,
                  field_id: fieldId,
                  hint,
                }
              } else {
                result.input = {
                  editable: true,
                  is_password: false,
                  too_long: false,
                  field_id: fieldId,
                  text: cleaned,
                  hint,
                }
              }
            }
          }
        }
      }
    }
  }
} catch (_) { /* Accessibility access may be withheld or element unreadable. */ }
`
}

function isMacAccessibilityGranted() {
  if (process.platform !== 'darwin') return true
  try {
    const { systemPreferences } = require('electron')
    return Boolean(systemPreferences?.isTrustedAccessibilityClient?.(false))
  } catch {
    return true
  }
}

function enableTextInputCapture() {
  if (process.platform !== 'darwin') return
  const { systemPreferences } = require('electron')
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    systemPreferences.isTrustedAccessibilityClient(true)
    throw new Error(
      '请在 macOS 系统设置的“隐私与安全性 → 辅助功能”中允许 Wintermute，然后重新开启前台文本输入采集',
    )
  }
}

module.exports = {
  sampleWindowsFocusedInput,
  closeInputProbe,
  macInputScript,
  isMacAccessibilityGranted,
  enableTextInputCapture,
}
