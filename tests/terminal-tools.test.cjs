const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, existsSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { availableTools, runCommand, secureTransport, TerminalToolClient } = require('../electron/terminal-tools.cjs')

const win = process.platform === 'win32'
const tool = win ? 'powershell' : 'sh'
const claim = command => ({ id: 'call-1', claim_token: 'one-use', tool, arguments: {command}, timeout_seconds: 10 })
const exec = call => runCommand(call, new AbortController().signal)

test('desktop executes a local command and returns text, errors and exit code', async () => {
  assert.ok(availableTools().includes(tool))
  const result = await exec(claim(win ? '[Console]::WriteLine("周会"); [Console]::Error.WriteLine("err"); exit 7' : 'echo 周会; echo err >&2; exit 7'))
  assert.equal(result.status, 'failed')
  assert.equal(result.exit_code, 7)
  assert.equal(result.stdout.trim(), '周会')
  assert.match(result.stderr, /err/)
  if (win) {
    const cmd = await exec({...claim('echo ready'), tool:'cmd'})
    assert.equal(cmd.stdout.trim(), 'ready')
  }
  const large = await exec(claim(win ? 'Write-Output ("x" * 12000)' : 'yes x | head -c 12000'))
  assert.equal(large.truncated, true)
  assert.equal(Buffer.byteLength(large.stdout), 8192)
  const timeout = await exec({...claim(win ? 'Start-Sleep -Seconds 20' : 'sleep 20'), timeout_seconds:1})
  assert.equal(timeout.status, 'timed_out')
  assert.equal(timeout.exit_code, null)
  assert.equal((await exec({...claim('echo x'), tool:'__proto__'})).status, 'failed')
  assert.equal(secureTransport('http://localhost.example'),false)
})

test('restart resends the recorded result after a lost ACK or reports an interrupted claim', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wm-command-'))
  t.after(() => rmSync(dir,{force:true,recursive:true}))
  const marker = path.join(dir, 'marker').replaceAll("'", win ? "''" : "'\\''")
  const cmd = win ? `Add-Content -LiteralPath '${marker}' -Value done; Write-Output 已执行` : `echo done >> '${marker}'; echo 已执行`
  let journal = {}, attempts = 0, claims = 0
  const results = []
  const make = enabled => new TerminalToolClient({ file:'journal', enabled, tools:[tool],
    read: () => structuredClone(journal), save: (_,state) => {journal=structuredClone(state)}, onIssue(){},
    post: async (route, body) => {
      if (route.endsWith('/claim')) { claims++; return {call: claims === 1 ? claim(cmd) : null} }
      results.push(structuredClone(body))
      if (++attempts === 1) throw new Error('offline')
      return {}
    },
  })
  const before = make(false)
  await before.poll()
  assert.equal(claims,0)
  assert.equal(existsSync(marker),false)
  before.enabled = true
  await before.poll()
  assert.equal(journal.pending.body.stdout.trim(),'已执行')
  before.close()
  await make(true).poll()
  assert.deepEqual(results[0], results[1])
  assert.equal(readFileSync(marker,'utf8').trim(),'done')
  assert.equal(journal.pending,undefined)
  journal.pending={id:'interrupted',body:{claim_token:'x',status:'failed',stdout:'',stderr:'未知',exit_code:null,truncated:false}}
  await make(false).poll()
  assert.equal(results.at(-1).status,'failed')
  assert.equal(readFileSync(marker,'utf8').trim(),'done')
})

test('disabling while a claim is in flight declines it and advertises withdrawal', async () => {
  let release
  const bodies=[]
  const remote=new TerminalToolClient({file:'x',enabled:true,tools:[tool],read:()=>({}),save(){},onIssue(){},
    post: async (route, body) => {
      bodies.push(body)
      if (bodies.length===1) return new Promise(r=>{release=r})
      return {call:null}
    }})
  const poll = remote.poll()
  await new Promise(resolve => setImmediate(resolve))
  remote.setEnabled(false)
  release({call:claim('echo should-not-run')})
  await poll
  assert.equal(bodies[1].status,'failed')
  assert.equal(bodies[1].stdout,'')
  await remote.poll()
  assert.deepEqual(bodies[2],{tools:[]})
})
