const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DesktopAgent } = require('./agent.cjs')
const { ChatHistory } = require('./chat-history.cjs')
const { droppedChatFiles } = require('../src/lib/chat-media.ts')

test('pet drops keep supported files after the drag data store closes', async () => {
  let accessible = true
  const text = new File(['项目说明'], 'README')
  const document = new File(['test fixture'], '预算.XLSX')
  const binary = new File([Uint8Array.of(0, 255)], 'unknown.bin')
  function item(file, isDirectory = false) {
    return {
      kind: 'file',
      webkitGetAsEntry: () => ({ isDirectory }),
      getAsFile: () => accessible ? file : null,
    }
  }
  const pending = droppedChatFiles({
    items: [item(text), item(binary), item(document), item(new File([], '资料.txt'), true), { kind: 'string' }],
  })
  accessible = false
  assert.deepEqual(await pending, [text, document])
})

test('attachment-only drafts retain their pictures, names and document references across both types of retry', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wintermute-chat-'))
  const file = path.join(dir, 'outbox.json')
  t.after(() => {
    if (fs.existsSync(file)) fs.unlinkSync(file)
    fs.rmdirSync(dir)
  })
  const agent = Object.create(DesktopAgent.prototype)
  const history = { outbox: [] }
  agent.profile = { token: 'local', controller: new AbortController(), file, history, chat: new ChatHistory() }
  agent.sync = agent.publish = () => {}
  const images = ['data:image/jpeg;base64,/9j/']
  const imageNames = ['截图.png']
  const documents = [{ id: 'doc_' + 'a'.repeat(64), name: '说明.md' }]
  agent.send({ text: '', images, imageNames, documents })
  const first = history.outbox[0]
  const saved = JSON.parse(fs.readFileSync(file)).outbox[0]
  assert.deepEqual(saved.images, images)
  assert.deepEqual(saved.imageNames, imageNames)
  assert.deepEqual(saved.documents, documents)
  first.status = 'unsent'
  agent.retry(first.id)
  assert.equal(history.outbox.length, 1)
  assert.equal(first.status, 'queued')
  first.status = 'failed'
  agent.retry(first.id)
  assert.notEqual(history.outbox[1].id, first.id)
  assert.deepEqual(history.outbox[1].images, images)
  assert.deepEqual(history.outbox[1].imageNames, imageNames)
  assert.deepEqual(history.outbox[1].documents, documents)
})
