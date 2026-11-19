const recordTypes = ['sms', 'call_log', 'contacts', 'notion', 'recording_list', 'document']
const recordStates = ['pending', 'filtered', 'processing', 'processed', 'failed']
const validId = value => typeof value === 'string' && /^rec_[0-9a-f]{32}$/.test(value)
const isDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const isCount = value => Number.isSafeInteger(value) && value >= 0
const nullableString = value => value === null || typeof value === 'string'

function validPath(value) {
  return typeof value === 'string' && value.length <= 1024 &&
    !/[\\:]/.test(value) && !Array.from(value).some(char => char.charCodeAt(0) < 32) &&
    value.split('/').every(part => part && !part.startsWith('.'))
}

function fileRoute(path) {
  if (!validPath(path) || !path.endsWith('.md')) throw new Error('无效的档案路径')
  return '/v1/memory/file?' + new URLSearchParams({ path })
}

function recordsRoute({ cursor, recordType } = {}) {
  const query = new URLSearchParams({ limit: '40' })
  if (cursor !== undefined) {
    if (!validId(cursor)) throw new Error('无效的记录分页位置')
    query.set('cursor', cursor)
  }
  if (recordType !== undefined) {
    if (!recordTypes.includes(recordType)) throw new Error('无效的记录类型')
    query.set('record_type', recordType)
  }
  return '/v1/records/items?' + query
}

function contentRoute({ id, offset = 0 } = {}) {
  if (!validId(id) || !isCount(offset) || offset > 16 * 1024 * 1024 * 6)
    throw new Error('无效的记录原文位置')
  return '/v1/records/items/' + id + '?' + new URLSearchParams({ offset, limit: '16000' })
}

function validateTree(tree) {
  if (!Array.isArray(tree?.files)) throw new Error('后端返回的档案目录格式无效')
  const seen = new Set()
  const files = []
  for (const file of tree.files) {
    if (!validPath(file?.path) || typeof file.is_dir !== 'boolean' ||
        !isCount(file.bytes) || !isDate(file.updated_at) || seen.has(file.path) ||
        (file.title !== undefined && typeof file.title !== 'string') ||
        (file.summary !== undefined && typeof file.summary !== 'string'))
      throw new Error('后端返回的档案目录格式无效')
    seen.add(file.path)
    if (!file.is_dir && file.path.endsWith('.md'))
      files.push({ path: file.path, bytes: file.bytes, updated_at: file.updated_at,
        title: file.title, summary: file.summary })
  }
  return files
}

function validateFile(document, path) {
  if (document?.path !== path || typeof document.content !== 'string' ||
      typeof document.content_sha256 !== 'string' || !/^[0-9a-f]{16}$/.test(document.content_sha256))
    throw new Error('后端返回的档案内容格式无效')
  return { path, content: document.content, content_sha256: document.content_sha256 }
}

function validateRecords(page) {
  if (!Array.isArray(page?.items) || page.items.length > 40 ||
      !(page.next_cursor === null || validId(page.next_cursor)))
    throw new Error('后端返回的记录列表格式无效')
  const items = page.items.map(item => {
    if (!validId(item?.item_id) || !recordTypes.includes(item.record_type) ||
        !recordStates.includes(item.status) || !isDate(item.occurred_at) ||
        !isDate(item.received_at) || typeof item.source_name !== 'string' ||
        typeof item.batch_id !== 'string' || !nullableString(item.title) ||
        !nullableString(item.external_id) || !nullableString(item.error) || !isCount(item.attempts))
      throw new Error('后端返回的记录列表格式无效')
    const { item_id, record_type, source_name, batch_id, occurred_at, received_at,
      title, external_id, status, attempts, error } = item
    return { id: item_id, record_type, source_name, batch_id, occurred_at, received_at,
      title, external_id, status, attempts, error }
  })
  return { items, next_cursor: page.next_cursor }
}

function validateContent(page, { id, offset = 0 }) {
  if (page?.item_id !== id || page.offset !== offset || typeof page.text !== 'string' ||
      !['text', 'json'].includes(page.format) || !isCount(page.total_chars) ||
      !(page.next_offset === null || (isCount(page.next_offset) &&
        page.next_offset > offset && page.next_offset < page.total_chars)))
    throw new Error('后端返回的记录原文格式无效')
  // Python offsets count Unicode code points, not JavaScript UTF-16 code units.
  const end = offset + Array.from(page.text).length
  if (end > page.total_chars || end - offset > 16000 ||
      (page.next_offset === null ? end !== page.total_chars : end !== page.next_offset))
    throw new Error('后端返回的记录原文分页无效')
  return { text: page.text, format: page.format, offset,
    next_offset: page.next_offset, total_chars: page.total_chars }
}

module.exports = { fileRoute, recordsRoute, contentRoute, validateTree,
  validateFile, validateRecords, validateContent }
