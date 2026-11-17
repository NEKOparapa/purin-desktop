// Launch a real Electron window against a loopback HTTP fixture or a running Wintermute instance.
const { _electron: electron, expect } = require('@playwright/test')
const http = require('node:http')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

async function fixture() {
  const outputs = new Map()
  const messages = new Map()
  const events = new Map()
  const slices = new Map()
  let downloads = 0
  const file = { id: 'evt-meeting', name: '会议录音.ogg' }
  const fileBytes = Buffer.from('OggS-smoke-test')
  const token = 'fixture-token'
  const server = http.createServer(async (req, res) => {
    const route = req.url.split('?')[0]
    function json(status, data) {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    }
    if (
      req.headers['x-terminal-id'] !== 'http-desktop' ||
      req.headers.authorization !== 'Bearer ' + token
    )
      return json(401, {})
    let data = ''
    for await (const part of req) data += part
    const body = data ? JSON.parse(data) : {}
    if (route === '/v1/messages') {
      const job = body.message_id
      messages.set(job, body.text)
      const output = {
        output_id: 'out-' + job,
        job_id: job,
        layer: 'conversation',
        text: '会议将在周五举行。',
      }
      outputs.set(output.output_id, output)
      return json(202, {event_id: 'event-'+job, job_id: job })
    }
    if (route === '/v1/outputs')
      return json(200, { outputs: [...outputs.values()] })
    if (route === '/v1/history') {
      const view = new URL(req.url, 'http://localhost').searchParams.get('view')
      if(view === 'dialogue') return json(200, {
        items:[...messages].reverse().flatMap(([id,text]) => [
          {id:'out-'+id, role:'assistant', text:'会议将在周五举行。', occurred_at:null},
          {id:'event-'+id, role:'user', text, message_id:id, terminal_id:'http-desktop', occurred_at:'2026-11-14T02:00:00Z'},
        ]), next_cursor:null,
      })
      const items =
        view === 'chat'
          ? [...messages].map(([id, text]) => ({
              id,
              text,
              role: 'user',
              source: '用户原话 · http-desktop',
              occurred_at: '2026-11-14T02:00:00Z',
              files: [],
            }))
          : view === 'slice'
            ? [
                {
                  id: file.id,
                  text: '',
                  role: 'user',
                  source: '会议录音',
                  occurred_at: '2026-11-14T02:01:00Z',
                  files: [file],
                },
              ]
            : []
      return json(200, { items, next_cursor: null })
    }
    if (route === '/v1/history/files/' + file.id) {
      downloads++
      res.writeHead(200, {
        'Content-Type': 'audio/ogg',
        'Content-Length': fileBytes.length,
      })
      return res.end(fileBytes)
    }
    if (route.startsWith('/v1/jobs/')) return json(200, { status: 'completed' })
    if (route.startsWith('/v1/outputs/') && route.endsWith('/ack')) {
      outputs.delete(route.split('/')[3])
      return json(200, { status: 'delivered' })
    }
    if (route === '/v1/perceptions') {
      events.set(body.event_id, body)
      return json(202, { event_id: body.event_id, duplicate: false })
    }
    if (route === '/v1/slices') {
      slices.set(body.event_id, body)
      return json(202, { event_id: body.event_id, duplicate: false })
    }
    return json(404, {})
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    token,
    events,
    slices,
    outputs,
    messages,
    file,
    fileBytes,
    get downloads() {
      return downloads
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function main() {
  const api = process.env.WINTERMUTE_TEST_URL ? null : await fixture()
  const url = api?.url || process.env.WINTERMUTE_TEST_URL
  const token = api?.token || process.env.WINTERMUTE_TEST_TOKEN
  const reply = api ? '会议将在周五举行。' : process.env.WINTERMUTE_TEST_REPLY
  if (!token || !reply)
    throw new Error(
      'Set WINTERMUTE_TEST_TOKEN and WINTERMUTE_TEST_REPLY for the live service.',
    )
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'wintermute-desktop-smoke-'),
  )
  const executable = process.argv[2]
  const launch = () =>
    electron.launch({
      ...(executable ? { executablePath: path.resolve(executable) } : {}),
      args: [
        ...(executable ? [] : ['.', '--preview']),
        '--user-data-dir=' + dir,
      ],
    })
  let app
  const previewDir = path.resolve('test-results/ui-final')
  fs.mkdirSync(previewDir, { recursive: true })
  try {
    app = await launch()
    const win = await app.firstWindow()
    assert.equal(await win.evaluate(() => typeof window.require), 'undefined')
    await expect(
      win.getByRole('heading', { name: '有什么想聊的？' }),
    ).toBeVisible()
    assert.equal(
      await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource),
      'system',
    )
    await win.getByRole('button', { name: '终端设置' }).click()
    await expect(win.getByLabel('服务地址')).toBeVisible()
    await win.getByRole('button', { name: '外观', exact: true }).click()
    await expect(win.getByRole('radio', { name: '跟随系统' })).toBeChecked()
    const dark = win.getByRole('radio', { name: '深色' })
    await dark.click()
    await expect(dark).toBeChecked()
    await expect(win.locator('.workspace')).toHaveCSS(
      'background-color',
      'rgb(22, 23, 27)',
    )
    const light = win.getByRole('radio', { name: '浅色' })
    await light.click()
    await expect(light).toBeChecked()
    await expect(win.locator('.workspace')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    )
    assert.equal(
      await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource),
      'light',
    )
    await win.getByRole('button', { name: '关闭', exact: true }).click()
    await win.screenshot({
      path: path.join(previewDir, 'desktop-light.png'),
      scale: 'css',
    })
    await win.getByRole('button', { name: '终端设置' }).click()
    await win.screenshot({
      path: path.join(previewDir, 'desktop-light-settings.png'),
      scale: 'css',
    })
    await win.getByLabel('服务地址').fill(url)
    await win.getByLabel('终端令牌').fill(token)
    await win.getByRole('button', { name: '验证并保存' }).click()
    await win.getByText('连接已保存').waitFor()
    await expect(
      win.getByRole('dialog').getByText(new URL(url).origin, { exact: true }),
    ).toBeVisible()
    await expect(
      win.getByRole('dialog').getByText('http-desktop', { exact: true }),
    ).toBeVisible()
    if (api) {
      await win.screenshot({
        path: path.join(previewDir, 'connection-settings.png'),
        scale: 'css',
      })
    }
    await win.getByRole('button', { name: '信息采集' }).click()
    const collecting = win.getByLabel('采集桌面活动')
    await expect(
      win.getByRole('checkbox', { name: /窗口标题|停留时段/ }),
    ).toHaveCount(0)
    await expect(
      win.getByRole('button', { name: /ICS|订阅日历|移除日历/ }),
    ).toHaveCount(0)
    await expect(
      win.getByRole('checkbox', { name: '浏览器接入' }),
    ).toHaveCount(0)
    await expect(collecting).not.toBeChecked()
    if (api) {
      // Drive the Electron main process with known windows and real elapsed time.
      await app.evaluate(({ app }) => {
        const { createRequire } = process.getBuiltinModule('node:module')
        const localRequire = createRequire(app.getAppPath() + '/package.json')
        const { DesktopAgent } = localRequire('./electron/agent.cjs')
        const capture = DesktopAgent.prototype.capture
        let appName = 'Chrome'
        let title = '项目周会'
        DesktopAgent.prototype.capture = function () {
          this.sample = async () => ({
            activity: 'active',
            foreground_app: appName,
            window_title: title,
          })
          globalThis.confirmedMeetingApp = () => this.profile.history.windowSpan?.app
          globalThis.confirmedMeetingTitle = () =>
            this.profile.history.windowSpan?.workObjects?.at(-1)?.window_title
          globalThis.sampleMeetingWindow = async ([app, nextTitle]) => {
            appName = app
            title = nextTitle
            await this.capture()
          }
          return capture.call(this)
        }
      })
    }
    await collecting.click()
    await expect(collecting).toBeChecked()
    if (api) {
      const sample = (name, title) =>
        app.evaluate((_, pair) => globalThis.sampleMeetingWindow(pair), [name, title])
      await expect
        .poll(() => app.evaluate(() => globalThis.confirmedMeetingApp()), { timeout: 12000 })
        .toBe('Chrome')
      assert.equal(api.events.size, 0)
      await sample('邮件', '误切的窗口')
      await sample('Chrome', '会议纪要')
      await expect
        .poll(() => app.evaluate(() => globalThis.confirmedMeetingTitle()), { timeout: 12000 })
        .toBe('会议纪要')
      await sample('Wintermute', '记忆')
    }
    if (api) {
      const screenshots = win.getByLabel('自动截图（前台窗口）')
      await screenshots.click()
      await expect(screenshots).toBeChecked()
      await expect(win.getByText(/同一应用连续在前台停留满 10 分钟时截一张/)).toBeVisible()
      const spans = () =>
        [...api.events.values()].filter(
          (event) => event.state_key === 'desktop.window_span',
        )
      await expect.poll(() => spans().length, { timeout: 35000 }).toBe(3)
      const [first, brief, span] = spans()
      assert.deepEqual([first, brief, span].map(event => event.value.foreground_app), ['Chrome', '邮件', 'Chrome'])
      assert.equal(brief.value.work_objects[0].window_title, '误切的窗口')
      assert.equal(span.value.foreground_app, 'Chrome')
      assert.equal(span.value.window_title, '会议纪要')
      assert.ok(span.value.duration_seconds >= 0)
      assert.equal(span.occurred_at, span.value.ended_at)
      assert.equal(api.slices.size, 0)
      await expect(win.getByText(/最近一次停留 ·/)).toContainText('会议纪要')
    }
    await collecting.click()
    await expect(collecting).not.toBeChecked()
    await expect(win.getByLabel('自动截图（前台窗口）')).not.toBeChecked()
    await win.getByRole('button', { name: '关闭', exact: true }).click()

    await win
      .getByRole('textbox', { name: '对话消息' })
      .fill('这次会议决定了什么？')
    await win.getByRole('button', { name: '发送对话消息' }).click()
    await expect(win.getByRole('log')).toContainText(reply, { timeout: 20000 })
    await win.screenshot({
      path: path.join(previewDir, 'desktop-light-meeting.png'),
      scale: 'css',
    })
    if (api) {
      await expect.poll(() => api.outputs.size).toBe(0)
      assert.equal(api.messages.size, 1)
      assert.deepEqual([...api.events.values()].map((event) => event.state_key), Array(3).fill('desktop.window_span'))
    }
    await win.getByRole('button', { name: '记忆', exact: true }).click()
    await expect(
      win
        .getByRole('region', { name: '对话历史' })
        .getByText('这次会议决定了什么？', { exact: true }),
    ).toBeVisible()
    const captureNavigation = (filename) =>
      app.evaluate(
        async ({ BrowserWindow }, file) => {
          const window = BrowserWindow.getAllWindows()[0]
          const shot = await window.webContents.capturePage(undefined, {
            stayAwake: true,
          })
          await process
            .getBuiltinModule('node:fs/promises')
            .writeFile(file, shot.toPNG())
        },
        path.join(previewDir, filename),
      )
    if (api) await captureNavigation('navigation-expanded.png')
    await win.getByRole('button', { name: '收起导航栏' }).click()
    await expect(win.getByRole('button', { name: '展开导航栏' })).toBeVisible()
    if (api) {
      await captureNavigation('navigation-collapsed.png')
      await win.getByRole('button', { name: '切片层', exact: true }).click()
      const attachment = win.getByRole('button', {
        name: api.file.name,
        exact: true,
      })
      await expect(attachment).toBeVisible()
      assert.equal(api.downloads, 0)
      const destination = path.join(dir, api.file.name)
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, destination)
      await attachment.click()
      await expect.poll(() => fs.existsSync(destination)).toBe(true)
      assert.equal(api.downloads, 1)
      assert.deepEqual(fs.readFileSync(destination), api.fileBytes)
      // The legacy fixture has no comparison endpoints; the packaged IPC must
      // still let people return to their ordinary layer records.
      await win.getByRole('button', { name: '压缩对照', exact: true }).click()
      await expect(win.getByRole('alert')).toContainText('请升级后端')
      await win.getByRole('button', { name: '记录', exact: true }).click()
      await expect(attachment).toBeVisible()
    }
    await app.close()
    app = await launch()
    const restored = await app.firstWindow()
    await expect(
      restored.getByRole('button', { name: '展开导航栏' }),
    ).toBeVisible()
    assert.equal(
      await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource),
      'light',
    )
    await expect(restored.locator('.workspace')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    )
    await restored.getByRole('button', { name: '终端设置' }).click()
    await expect(
      restored.getByRole('dialog').getByText('http-desktop', { exact: true }),
    ).toBeVisible()
    await restored.getByRole('button', { name: '外观', exact: true }).click()
    await expect(restored.getByRole('radio', { name: '浅色' })).toBeChecked()
    await restored.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(restored.getByRole('log')).toContainText(reply)
    await expect(restored.getByRole('log')).toContainText(
      '这次会议决定了什么？',
    )
    assert.equal(
      await restored.evaluate(() =>
        window.wintermute.state().then((s) => s.collecting),
      ),
      false,
    )
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(860, 680),
    )
    await expect(
      restored.getByRole('button', { name: '发送对话消息' }),
    ).toBeInViewport()
    await restored.screenshot({
      path: path.join(previewDir, 'desktop-light-compact.png'),
      scale: 'css',
    })
    console.log(
      'Electron verified connection, opt-in activity, meeting reply, server history, and restart persistence.',
    )
  } finally {
    await app?.close()
    await api?.close()
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
