// Keep only pages the user has opened. Each poll replaces the current head,
// even when it is empty or belongs to a newly created server database.
async function readPage(api, previous, more) {
  const query = new URLSearchParams({ view: 'dialogue', limit: '50' })
  if (more) query.set('cursor', previous.next)
  const { items, next_cursor: next } = await api('/v1/history?' + query)
  if (
    !Array.isArray(items) ||
    !(next === null || typeof next === 'string') ||
    !items.every(
      (row) =>
        typeof row?.id === 'string' &&
        typeof row.text === 'string' &&
        typeof row.role === 'string',
    )
  )
    throw new Error('对话历史格式无效')
  if (more) {
    if (next && next === previous.next) throw new Error('对话历史分页位置无效')
    const ids = new Set(previous.items.map((item) => item.id))
    return {
      items: [...previous.items, ...items.filter((item) => !ids.has(item.id))],
      next,
    }
  }
  if (next && items.length && previous) {
    const overlap = previous.items.findIndex(
      (item) => item.id === items.at(-1).id,
    )
    if (overlap >= 0)
      return {
        items: [...items, ...previous.items.slice(overlap + 1)],
        next: previous.next,
      }
  }
  return { items, next }
}

function chatRow(row) {
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    ...(row.role === 'user' && Array.isArray(row.files) && row.files.length && { files: row.files }),
    at: row.occurred_at ?? null,
    ...(row.message_id && {
      messageId: row.message_id,
      deviceId: row.device_id,
    }),
  }
}

class ChatHistory {
  messages = []
  hasEarlier = false
  #page
  #reading
  async read(api, more = false) {
    if (this.#reading) {
      if (!more) return this.#reading
      await this.#reading
    }
    const read = this.#update(api, more)
    this.#reading = read
    try {
      return await read
    } finally {
      if (this.#reading === read) this.#reading = undefined
    }
  }
  async #update(api, more) {
    if (more && !this.hasEarlier) return false
    const page = await readPage(api, this.#page, more)
    this.#page = page
    const messages = [...page.items].reverse().map(chatRow)
    const hasEarlier = Boolean(page.next)
    if (
      this.hasEarlier === hasEarlier &&
      JSON.stringify(this.messages) === JSON.stringify(messages)
    )
      return false
    this.hasEarlier = hasEarlier
    this.messages = messages
    return true
  }
}

module.exports = { ChatHistory }
