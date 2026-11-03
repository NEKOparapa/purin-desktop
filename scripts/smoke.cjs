// Tests the packaged application, including file:// asset paths and Electron isolation.
const { _electron: electron } = require('@playwright/test')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const executablePath = process.argv[2]
  if (!executablePath)
    throw new Error(
      'Usage: node scripts/smoke.cjs <path-to-Wintermute-executable>',
    )
  const app = await electron.launch({
    executablePath: path.resolve(executablePath),
  })
  try {
    const window = await app.firstWindow()
    await window.getByRole('heading', { name: '慢慢来，我一直在。' }).waitFor()
    assert.equal(
      await window.evaluate(() => typeof window.require),
      'undefined',
    )
    await window.getByRole('button', { name: '聊一聊今天' }).click()
    await window.getByRole('textbox', { name: '对话消息' }).fill('你好')
    await window.getByRole('button', { name: '发送对话消息' }).click()
    await window.getByText('Wintermute · 模拟回复').waitFor()
    await window.getByRole('button', { name: '关闭', exact: true }).click()
    await window.screenshot({ path: 'test-results/windows-app.png' })
    console.log('Packaged Electron smoke test passed.')
  } finally {
    await app.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
