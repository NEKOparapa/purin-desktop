const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { inspectVault, runObsidianTool } = require('./obsidian-connector.cjs')

test('obsidian connector rejects directory links that leave the selected vault', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purin-obsidian-links-'))
  const vault = path.join(dir, 'vault')
  const outside = path.join(dir, 'outside')
  const link = path.join(vault, 'linked')
  try {
    fs.mkdirSync(vault)
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'note.md'), 'outside vault', 'utf8')
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    for (const args of [
      { action: 'read_note', path: 'linked/note.md' },
      { action: 'list_notes', folder: 'linked' },
      { action: 'write_note', path: 'linked/new.md', content: 'changed' },
      { action: 'append_note', path: 'linked/note.md', content: 'changed' },
    ]) {
      assert.equal(runObsidianTool(vault, args).status, 'failed', args.action)
    }
    assert.equal(fs.readFileSync(path.join(outside, 'note.md'), 'utf8'), 'outside vault')
    assert.equal(fs.existsSync(path.join(outside, 'new.md')), false)
  } finally {
    if (fs.existsSync(link)) fs.unlinkSync(link)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('obsidian connector supports vault operations and blocks path traversal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purin-obsidian-'))
  try {
    fs.mkdirSync(path.join(dir, '.obsidian'))
    fs.writeFileSync(path.join(dir, '.obsidian', 'app.json'), '{}', 'utf8')

    // Write & append note
    const writeRes = runObsidianTool(dir, {
      action: 'write_note',
      path: 'Projects/Purin',
      content: '# Purin\nConnector architecture notes.',
    })
    assert.equal(writeRes.status, 'succeeded')
    assert.equal(JSON.parse(writeRes.stdout).path, 'Projects/Purin.md')

    const appendRes = runObsidianTool(dir, {
      action: 'append_note',
      path: 'Projects/Purin.md',
      content: '- Obsidian connected',
    })
    assert.equal(appendRes.status, 'succeeded')

    // Inspect & vault_info
    const info = inspectVault(dir)
    assert.equal(info.valid, true)
    assert.equal(info.hasObsidianDir, true)
    assert.equal(info.noteCount, 1)

    const vaultInfo = runObsidianTool(dir, { action: 'vault_info' })
    assert.equal(vaultInfo.status, 'succeeded')
    assert.equal(JSON.parse(vaultInfo.stdout).noteCount, 1)

    // List, read, search
    const listRes = runObsidianTool(dir, { action: 'list_notes' })
    assert.equal(JSON.parse(listRes.stdout).notes[0].path, 'Projects/Purin.md')

    const readRes = runObsidianTool(dir, { action: 'read_note', path: 'Projects/Purin' })
    assert.match(JSON.parse(readRes.stdout).content, /Obsidian connected/)

    const searchRes = runObsidianTool(dir, { action: 'search_notes', query: 'architecture' })
    const matches = JSON.parse(searchRes.stdout).matches
    assert.equal(matches.length, 1)
    assert.equal(matches[0].path, 'Projects/Purin.md')

    // Security: path traversal and .obsidian are rejected
    const traversal = runObsidianTool(dir, { action: 'read_note', path: '../secret.md' })
    assert.equal(traversal.status, 'failed')
    const hidden = runObsidianTool(dir, { action: 'read_note', path: '.obsidian/app.json' })
    assert.equal(hidden.status, 'failed')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
