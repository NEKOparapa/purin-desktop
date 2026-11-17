import { useCallback, useEffect, useRef, useState } from 'react'
import type { HistoryItem, HistoryView } from './desktop'

export interface PageState {
  items: HistoryItem[]
  next: string | null
  requested: string | null
  loading: boolean
  error: string
}

export const emptyPage: PageState = {
  items: [],
  next: null,
  requested: null,
  loading: false,
  error: '',
}

export interface HistoryFilter {
  destination?: string
  from?: string
  to?: string
}

async function historyPage(
  view: HistoryView,
  groupId: string | null,
  cursor: string | null,
  filter?: HistoryFilter,
) {
  const api = window.wintermute
  if (!api) throw new Error('请在桌面应用中连接服务。')
  return api.history({
    view,
    ...(groupId && { groupId }),
    ...(cursor && { cursor }),
    ...(view === 'perception' && filter?.destination && filter.destination !== 'all'
      ? { destination: filter.destination }
      : {}),
    ...(view === 'perception' && filter?.from ? { from: filter.from } : {}),
    ...(view === 'perception' && filter?.to ? { to: filter.to } : {}),
  })
}

export function useHistoryPages(view: HistoryView, filter?: HistoryFilter) {
  const destination = filter?.destination
  const from = filter?.from
  const to = filter?.to
  const [pages, setPages] = useState(
    () =>
      new Map<string | null, PageState>([
        [null, { ...emptyPage, loading: true }],
      ]),
  )
  const pending = useRef(new Map<string | null, symbol>())
  const loaded = useRef<HistoryItem[]>([])
  useEffect(() => {
    loaded.current = pages.get(null)?.items ?? []
  }, [pages])
  const fetchPage = useCallback(
    (groupId: string | null, cursor: string | null, background = false) => {
      if (pending.current.has(groupId)) return
      const token = Symbol()
      pending.current.set(groupId, token)
      return historyPage(view, groupId, cursor, { destination, from, to })
        .then(async (page) => {
          if (pending.current.get(groupId) !== token) return
          if (view === 'perception' && background) {
            // Recognition can complete on an older page while the user has it open.
            const prior = loaded.current
            const unfinished = new Set(prior.filter(item => {
              const payload = item.raw?.payload as { image_recognition?: string } | undefined
              return payload?.image_recognition && payload.image_recognition !== 'ready'
            }).map(item => item.id))
            let chunk = page
            while (unfinished.size) {
              for (const item of chunk.items) unfinished.delete(item.id)
              if (!unfinished.size || !chunk.next_cursor || page.items.length >= prior.length) break
              chunk = await historyPage(view, null, chunk.next_cursor)
              if (pending.current.get(groupId) !== token) return
              page = { items: [...page.items, ...chunk.items], next_cursor: chunk.next_cursor }
            }
          }
          const items =
            view === 'timeline'
              ? page.items
                  .filter((item) => item.text.trim())
                  .map((item) => ({ ...item, files: [] }))
              : page.items
          const refresh = groupId === null && cursor === null
          if (refresh) pending.current.clear()
          setPages((previous) => {
            const next = refresh
              ? new Map<string | null, PageState>()
              : new Map(previous)
            const rows = new Map<string, HistoryItem>()
            if (cursor)
              for (const row of previous.get(groupId)?.items ?? [])
                rows.set(row.id, row)
            for (const row of items) rows.set(row.id, row)
            if (background && page.next_cursor && items.length) {
              const prior = previous.get(groupId)
              const last = items.at(-1)!
              const overlap = prior?.items.findIndex(
                (row) =>
                  row.id === last.id &&
                  (view === 'perception' || row.text === last.text) &&
                  row.source === last.source &&
                  row.occurred_at === last.occurred_at,
              )
              if (prior && overlap !== undefined && overlap >= 0)
                return next.set(groupId, {
                  ...prior,
                  items: [...items, ...prior.items.slice(overlap + 1)],
                  error: '',
                  loading: false,
                })
            }
            return next.set(groupId, {
              items: [...rows.values()],
              next: page.next_cursor,
              requested: cursor,
              error: '',
              loading: false,
            })
          })
        })
        .catch((error) => {
          if (pending.current.get(groupId) !== token) return
          setPages((previous) =>
            new Map(previous).set(groupId, {
              ...(previous.get(groupId) ?? emptyPage),
              loading: false,
              requested: cursor,
              error:
                error instanceof Error && error.message
                  ? error.message.replace(/^.*?Error: /, '')
                  : '读取历史失败，请重试。',
            }),
          )
        })
        .finally(() => {
          if (pending.current.get(groupId) === token)
            pending.current.delete(groupId)
        })
    },
    [view, destination, from, to],
  )
  useEffect(() => {
    pending.current.clear()
    queueMicrotask(() => {
      void fetchPage(null, null)
    })
    const requests = pending.current
    function refreshVisible() {
      if (document.visibilityState === 'visible')
        void fetchPage(null, null, true)
    }
    if (view !== 'chat' && view !== 'perception') return () => requests.clear()
    const timer = window.setInterval(refreshVisible, 5000)
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      requests.clear()
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [fetchPage, view])
  const read = useCallback(
    (groupId: string | null, cursor: string | null) => {
      if (pending.current.has(groupId)) return
      setPages((previous) =>
        new Map(previous).set(groupId, {
          ...(previous.get(groupId) ?? emptyPage),
          loading: true,
          requested: cursor,
          error: '',
        }),
      )
      void fetchPage(groupId, cursor)
    },
    [fetchPage],
  )
  return { pages, read }
}
