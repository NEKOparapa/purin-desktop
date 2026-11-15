const idPattern = /^[\w:-]{1,256}$/

function notificationPath(id) {
  if (typeof id !== 'string' || !idPattern.test(id))
    throw new Error('无效的通知编号')
  return '/v1/notifications/' + encodeURIComponent(id)
}

function pageRoute(cursor, pending = false) {
  const query = new URLSearchParams({ limit: pending ? '20' : '40' })
  if (pending) query.set('pending', '1')
  if (cursor != null) {
    if (typeof cursor !== 'string' || !/^\d{1,32}$/.test(cursor))
      throw new Error('无效的通知分页位置')
    query.set('cursor', cursor)
  }
  return '/v1/notifications?' + query
}

function validatePage(page) {
  if (
    !Array.isArray(page?.items) ||
    !(page.next_cursor === null || typeof page.next_cursor === 'string') ||
    !page.items.every(
      (n) =>
        typeof n?.id === 'string' &&
        idPattern.test(n.id) &&
        typeof n.title === 'string' &&
        typeof n.body === 'string' &&
        Number.isFinite(Date.parse(n.created_at)) &&
        Array.isArray(n.attachments) &&
        n.attachments.every(
          (a) =>
            a &&
            typeof a.id === 'string' &&
            idPattern.test(a.id) &&
            typeof a.name === 'string' &&
            Number.isSafeInteger(a.size_bytes) &&
            a.size_bytes >= 0,
        ),
    )
  ) {
    throw new Error('后端返回的通知格式无效')
  }
  return page
}

function expired(item) {
  return (
    item.expired === true ||
    (item.expires_at != null && Date.parse(item.expires_at) <= Date.now())
  )
}

// Keep a durable receipt until the server confirms it. A failed ACK after the
// native banner was shown must not show that same alert on the next launch.
async function deliverPending({ request, inFlight, save, present, active }) {
  const { items, next_cursor } = validatePage(
    await request(pageRoute(null, true)),
  )
  if (!active()) return
  if (!next_cursor && inFlight.length) {
    const pendingIds = new Set(items.map((n) => n.id))
    const kept = inFlight.filter((id) => pendingIds.has(id))
    if (kept.length !== inFlight.length) {
      inFlight.splice(0, inFlight.length, ...kept)
      save()
    }
  }
  const fresh = items.filter(
    (n) => !inFlight.includes(n.id) && !n.read_at && !expired(n),
  )
  if (fresh.length) {
    inFlight.push(...fresh.map((n) => n.id))
    save()
    if (present(fresh) === false) {
      inFlight.splice(inFlight.length - fresh.length, fresh.length)
      save()
      return
    }
  }
  for (const n of items) {
    if (!active()) return
    await request(notificationPath(n.id) + '/received', {})
    if (!active()) return
    const index = inFlight.indexOf(n.id)
    if (index >= 0) {
      inFlight.splice(index, 1)
      save()
    }
  }
}

module.exports = { notificationPath, pageRoute, validatePage, deliverPending }
