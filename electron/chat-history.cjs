// Keep only pages the user has opened. Each poll replaces the current head,
// even when it is empty or belongs to a newly created server database.
async function readPage(api, view, previous, more) {
  if (more && !previous?.next) return previous
  const query = new URLSearchParams({ view, limit: '50' })
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

function chatRow(row, layer = row.layer) {
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    ...(row.role === 'user' && Array.isArray(row.files) && row.files.length && { files: row.files }),
    at: row.occurred_at ?? null,
    ...(row.role === 'assistant' &&
      layer === 'notification' && { notificationReply: true }),
    ...(row.message_id && {
      messageId: row.message_id,
      deviceId: row.device_id ?? row.terminal_id,
    }),
  }
}

// Older servers expose the two journals separately. Each answer follows its
// triggering input; the journal stores its input time, but no answer time.
function legacyRows(page, showInputs) {
  const rows = []
  let order = null
  for (const item of [...page.items].reverse()) {
    if (item.role === 'user') order = Date.parse(item.occurred_at)
    if (item.role === 'assistant' || (showInputs && item.role === 'user'))
      rows.push({
        message: chatRow(item, showInputs ? 'conversation' : 'notification'),
        order: Date.parse(item.occurred_at) || order || 0,
      })
  }
  return rows
}

class ChatHistory {
  messages = []
  hasEarlier = false
  #pages = {}
  #probeDialogueAt = 0
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
    if (
      !this.#pages.conversation ||
      (!more && Date.now() >= this.#probeDialogueAt)
    ) {
      if (this.#pages.conversation) this.#probeDialogueAt = Date.now() + 60_000
      try {
        const page = await readPage(api, 'dialogue', this.#pages.dialogue, more)
        this.#pages = { dialogue: page }
        return this.#apply(
          [...page.items].reverse().map((item) => chatRow(item)),
          !!page.next,
        )
      } catch (error) {
        if (more || error.status !== 400 || error.code !== 'invalid_query')
          throw error
        this.#probeDialogueAt = Date.now() + 60_000
      }
    }
    const [conversation, notification] = await Promise.all(
      ['conversation', 'notification'].map((view) =>
        readPage(api, view, this.#pages[view], more),
      ),
    )
    this.#pages = { conversation, notification }
    const ordered = [
      ...legacyRows(conversation, true),
      ...legacyRows(notification, false),
    ]
      .sort((a, b) => a.order - b.order)
      .map((row) => row.message)
    return this.#apply(ordered, !!(conversation.next || notification.next))
  }
  #apply(messages, more) {
    if (
      this.hasEarlier === more &&
      JSON.stringify(this.messages) === JSON.stringify(messages)
    )
      return false
    this.hasEarlier = more
    this.messages = messages
    return true
  }
}

module.exports = { ChatHistory }
