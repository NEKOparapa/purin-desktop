'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  MAX_INPUT_LENGTH,
  PLACEHOLDER,
  filterInputText,
  isPasswordHint,
  isVerificationCodeHint,
  redactSensitiveText,
} = require('./text-input-filter.cjs')
const { TextInputTracker } = require('./text-input-tracker.cjs')
const { advanceWindowSpan, appendInputSegments, maxInputSegments } = require('./window-spans.cjs')
const { DesktopAgent } = require('./agent.cjs')

test('length filter allows up to 500 code points and rejects 501+', () => {
  const exactAscii = 'a'.repeat(MAX_INPUT_LENGTH)
  const overAscii = 'a'.repeat(MAX_INPUT_LENGTH + 1)
  assert.deepEqual(filterInputText(exactAscii), {
    ok: true,
    text: exactAscii,
    redacted: false,
  })
  assert.deepEqual(filterInputText(overAscii), { ok: false, reason: 'too_long' })

  const exactChinese = '中'.repeat(MAX_INPUT_LENGTH)
  const overChinese = '中'.repeat(MAX_INPUT_LENGTH + 1)
  assert.equal(filterInputText(exactChinese).ok, true)
  assert.deepEqual(filterInputText(overChinese), { ok: false, reason: 'too_long' })

  // Surrogate-pair emoji counts as 1 code point each, not 2 UTF-16 code units.
  const exactEmoji = '🚀'.repeat(MAX_INPUT_LENGTH)
  const overEmoji = '🚀'.repeat(MAX_INPUT_LENGTH + 1)
  assert.equal(filterInputText(exactEmoji).ok, true)
  assert.deepEqual(filterInputText(overEmoji), { ok: false, reason: 'too_long' })
})

test('redacts suspected API keys, private keys, passwords and URL credentials', () => {
  const samples = [
    ['key is sk-proj-AbCdEf1234567890GhIjKlMnOpQr', `key is ${PLACEHOLDER.secret}`],
    ['AKIAIOSFODNN7EXAMPLE', PLACEHOLDER.secret],
    ['ghp_1234567890abcdef1234567890abcdef1234', PLACEHOLDER.secret],
    ['github_pat_11AAAAAA0123456789abcdef_XYZ', PLACEHOLDER.secret],
    ['AIzaSyD-1234567890abcdefghijklmnopqrstuvwx', PLACEHOLDER.secret],
    ['api_key=mySuperSecretValue99', `api_key=${PLACEHOLDER.secret}`],
    ['密码是 Abc@123456，别外传', `密码是 ${PLACEHOLDER.secret}，别外传`],
    ['https://alice:hunter2@example.com/repo', `https://alice:${PLACEHOLDER.secret}@example.com/repo`],
    [
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
      PLACEHOLDER.secret,
    ],
  ]
  for (const [raw, expected] of samples) {
    assert.equal(redactSensitiveText(raw), expected)
  }
})

test('redacts suspected JWT, Bearer, query, labeled and high-entropy tokens', () => {
  const jwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
  assert.equal(redactSensitiveText(`Authorization: Bearer ${jwt}`), `Authorization: Bearer ${PLACEHOLDER.token}`)
  assert.equal(redactSensitiveText(`Bearer AbCdEfGhIjKlMnOpQrStUv`), `Bearer ${PLACEHOLDER.token}`)
  assert.equal(redactSensitiveText(`access_token=tok_abc123456789`), `access_token=${PLACEHOLDER.token}`)
  assert.equal(redactSensitiveText(`设备令牌：abcDEF123456`), `设备令牌：${PLACEHOLDER.token}`)
  assert.equal(
    redactSensitiveText(`https://api.example.com/v1?token=xyz987654&api_key=k_123456`),
    `https://api.example.com/v1?token=${PLACEHOLDER.token}&api_key=${PLACEHOLDER.secret}`,
  )
  assert.equal(
    redactSensitiveText(`使用 Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56 登录`),
    `使用 ${PLACEHOLDER.token} 登录`,
  )
  assert.equal(
    redactSensitiveText(`hash 0123456789abcdef0123456789abcdef`),
    `hash ${PLACEHOLDER.token}`,
  )
})

test('redacts suspected bank card numbers without mangling normal numbers', () => {
  assert.equal(redactSensitiveText('转到 6222021234567890128 吧'), `转到 ${PLACEHOLDER.bankCard} 吧`)
  assert.equal(redactSensitiveText('4111 1111 1111 1111'), PLACEHOLDER.bankCard)
  assert.equal(redactSensitiveText('5500-0000-0000-0004'), PLACEHOLDER.bankCard)
  assert.equal(redactSensitiveText('银行卡号：6222 0212 3456 7890'), `银行卡号：${PLACEHOLDER.bankCard}`)

  // Non-card numbers should stay intact.
  const normal = '今天2026-11-23时间戳1763890000000，预算50000元'
  assert.equal(redactSensitiveText(normal), normal)
})

test('redacts suspected verification codes in context and standalone inputs', () => {
  assert.equal(redactSensitiveText('验证码 482910'), `验证码 ${PLACEHOLDER.code}`)
  assert.equal(redactSensitiveText('登录校验码是：8392，五分钟有效'), `登录校验码是：${PLACEHOLDER.code}，五分钟有效`)
  assert.equal(redactSensitiveText('482910 是验证码'), `${PLACEHOLDER.code} 是验证码`)
  assert.equal(redactSensitiveText('Your OTP: 739104'), `Your OTP: ${PLACEHOLDER.code}`)
  assert.equal(redactSensitiveText('482910'), PLACEHOLDER.code)
  assert.equal(redactSensitiveText('482 910'), PLACEHOLDER.code)
  assert.equal(redactSensitiveText('A9K2M4', { hint: '请输入短信验证码' }), PLACEHOLDER.code)

  // Normal digits inside prose must stay intact.
  const prose = '2026年Q4计划上线8080端口服务，共12000行代码'
  assert.equal(redactSensitiveText(prose), prose)
  assert.equal(isPasswordHint('请输入登录密码'), true)
  assert.equal(isPasswordHint('聊天输入框'), false)
  assert.equal(isVerificationCodeHint('OTP verification code'), true)
})

test('tracker coalesces IME typing, emits on submit, ignores pre-existing text and backspace cancels', () => {
  const tracker = new TextInputTracker({ pauseFlushMs: 5000 })
  const spanId = 'span-1'
  const t = (sec) => new Date(Date.parse('2026-11-23T10:00:00.000Z') + sec * 1000)

  // Focusing a pre-filled address bar without editing emits nothing.
  assert.deepEqual(
    tracker.observe(spanId, 'Chrome', { editable: true, field_id: 'url', text: 'https://example.com' }, t(0)),
    [],
  )
  assert.deepEqual(
    tracker.observe(spanId, 'Chrome', { editable: false }, t(2)),
    [],
  )

  // Chat typing with IME intermediate states -> submit clears input -> emits 1 clean segment.
  assert.deepEqual(
    tracker.observe(spanId, '张三', { editable: true, field_id: 'chat', text: '' }, t(5)),
    [],
  )
  assert.deepEqual(
    tracker.observe(spanId, '张三', { editable: true, field_id: 'chat', text: 'ming' }, t(6)),
    [],
  )
  assert.deepEqual(
    tracker.observe(spanId, '张三', { editable: true, field_id: 'chat', text: '明天上午十点评审' }, t(8)),
    [],
  )
  const sent = tracker.observe(spanId, '张三', { editable: true, field_id: 'chat', text: '' }, t(9))
  assert.equal(sent.length, 1)
  assert.equal(sent[0].text, '明天上午十点评审')
  assert.equal(sent[0].occurred_at, t(6).toISOString())
  assert.equal(sent[0].ended_at, t(8).toISOString())
  assert.equal(sent[0].window_title, '张三')

  // Typing then backspacing down to empty cancels without emitting.
  assert.deepEqual(
    tracker.observe(spanId, '张三', { editable: true, field_id: 'chat', text: '草稿' }, t(10)),
    [],
  )
  assert.deepEqual(
    tracker.observe(spanId, '张三', { editable: true, field_id: 'chat', text: '草' }, t(11)),
    [],
  )
  assert.deepEqual(
    tracker.observe(spanId, '张三', { editable: true, field_id: 'chat', text: '' }, t(12)),
    [],
  )
})

test('tracker handles pause flush delta, 500-char suppression, password skip and title switch', () => {
  const tracker = new TextInputTracker({ pauseFlushMs: 3000 })
  const spanId = 'span-2'
  const t = (sec) => new Date(Date.parse('2026-11-23T10:00:00.000Z') + sec * 1000)

  tracker.observe(spanId, '备忘录', { editable: true, field_id: 'note', text: '' }, t(0))
  tracker.observe(spanId, '备忘录', { editable: true, field_id: 'note', text: '第一段内容' }, t(1))
  // Pause >= 3s flushes first segment.
  const first = tracker.observe(spanId, '备忘录', { editable: true, field_id: 'note', text: '第一段内容' }, t(4))
  assert.equal(first.length, 1)
  assert.equal(first[0].text, '第一段内容')

  // Continuing in the same box emits only the new appended delta.
  tracker.observe(spanId, '备忘录', { editable: true, field_id: 'note', text: '第一段内容 第二段内容' }, t(6))
  const second = tracker.observe(spanId, '备忘录', { editable: true, field_id: 'note', text: '第一段内容 第二段内容' }, t(9))
  assert.equal(second.length, 1)
  assert.equal(second[0].text, '第二段内容')

  // Growing beyond 500 chars mid-typing discards uncommitted draft and suppresses until cleared.
  tracker.observe(spanId, '编辑器', { editable: true, field_id: 'doc', text: '' }, t(10))
  tracker.observe(spanId, '编辑器', { editable: true, field_id: 'doc', text: 'x'.repeat(490) }, t(11))
  assert.deepEqual(
    tracker.observe(spanId, '编辑器', { editable: true, field_id: 'doc', too_long: true }, t(12)),
    [],
  )
  // Deleting 2 chars back to 498 still stays suppressed until cleared or field changes.
  assert.deepEqual(
    tracker.observe(spanId, '编辑器', { editable: true, field_id: 'doc', text: 'x'.repeat(498) }, t(13)),
    [],
  )
  assert.equal(tracker.flush(spanId, t(14)), null)

  // Password field and password-hinted field are completely ignored.
  assert.deepEqual(
    tracker.observe(spanId, '登录', { editable: true, is_password: true, field_id: 'pw', text: 'secret123' }, t(15)),
    [],
  )
  assert.deepEqual(
    tracker.observe(spanId, '登录', { editable: true, field_id: 'pw2', hint: '登录密码', text: 'secret123' }, t(16)),
    [],
  )
  assert.equal(tracker.flush(spanId, t(17)), null)

  // Switching chat window with unread counter preserves draft; switching to another chat flushes under old title.
  tracker.observe(spanId, '(1) 张三', { editable: true, field_id: 'chat', text: '' }, t(20))
  tracker.observe(spanId, '(1) 张三', { editable: true, field_id: 'chat', text: '马上' }, t(21))
  assert.deepEqual(
    tracker.observe(spanId, '(2) 张三', { editable: true, field_id: 'chat', text: '马上到' }, t(22)),
    [],
  )
  const switched = tracker.observe(spanId, '李四', { editable: true, field_id: 'chat', text: '' }, t(23))
  assert.equal(switched.length, 1)
  assert.equal(switched[0].text, '马上到')
  assert.equal(switched[0].window_title, '(2) 张三')
})

test('window-spans clamps input segments and caps count with input_segments_omitted', () => {
  const start = new Date('2026-11-23T10:00:00.000Z')
  const { active } = advanceWindowSpan(null, {
    activity: 'active',
    foreground_app: 'WeChat',
    window_title: '张三',
  }, start)
  for (let i = 0; i < maxInputSegments + 3; i++) {
    const at = new Date(start.getTime() + (i + 1) * 1000)
    active.lastSeen = at.toISOString()
    appendInputSegments(active, [{ occurred_at: at.toISOString(), text: `消息 ${i}` }], active.lastSeen)
  }
  const end = new Date(start.getTime() + (maxInputSegments + 5) * 1000)
  const { finished } = advanceWindowSpan(active, { activity: 'locked' }, end)
  assert.equal(finished.value.input_segments.length, maxInputSegments)
  assert.equal(finished.value.input_segments[0].text, '消息 0')
  assert.equal(finished.value.input_segments.at(-1).text, `消息 ${maxInputSegments + 2}`)
  assert.equal(finished.value.input_segments_omitted, 3)
})

test('DesktopAgent records, redacts, flushes and clears foreground text input segments', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wintermute-text-input-'))
  const samples = [
    {
      activity: 'active',
      foreground_app: 'WeChat',
      window_title: '张三',
      pid: 999999,
      input: { editable: true, field_id: 'f1', text: '' },
    },
    {
      activity: 'active',
      foreground_app: 'WeChat',
      window_title: '张三',
      pid: 999999,
      input: { editable: true, field_id: 'f1', text: '验证码 482910，明天见' },
    },
    {
      activity: 'active',
      foreground_app: 'Chrome',
      window_title: '首页',
      pid: 999998,
      input: { editable: false },
    },
  ]
  let idx = 0
  const agent = Object.assign(Object.create(DesktopAgent.prototype), {
    dir,
    configFile: path.join(dir, 'agent-settings.json'),
    appearance: 'system',
    notify() {},
    sample: async () => samples[Math.min(idx++, samples.length - 1)],
    sampleInput: async () => null,
    inputTracker: new TextInputTracker(),
    profile: {
      url: 'http://127.0.0.1:8080',
      deviceId: 'desktop-test',
      deviceName: '测试设备',
      installation: 'inst-1',
      secret: 'enc',
      token: 'tok',
      revision: 1,
      file: path.join(dir, 'terminal.json'),
      mediaDirectory: path.join(dir, 'media'),
      controller: new AbortController(),
      captureController: new AbortController(),
      collecting: true,
      screenshotsEnabled: false,
      textInputEnabled: true,
      macConnectorIds: [],
      history: { outbox: [], materials: [], windowSpan: null },
      chat: { messages: [], replyReceivedAt: 0, hasEarlier: false },
    },
  })

  try {
    await agent.capture()
    await agent.capture()
    await agent.capture()

    assert.equal(agent.profile.history.materials.length, 1)
    const span = agent.profile.history.materials[0].body.value
    assert.equal(span.foreground_app, 'WeChat')
    assert.equal(span.input_segments.length, 1)
    assert.equal(span.input_segments[0].text, `验证码 ${PLACEHOLDER.code}，明天见`)
    assert.equal(span.input_segments[0].window_title, '张三')

    // Disabling text input clears queued input_segments without dropping the dwell itself.
    agent.setTextInput({ enabled: false })
    assert.equal(agent.profile.textInputEnabled, false)
    assert.equal(agent.profile.history.materials.length, 1)
    assert.equal(agent.profile.history.materials[0].body.value.input_segments, undefined)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
