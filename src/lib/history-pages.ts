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

async function historyPage(
  view: HistoryView,
  groupId: string | null,
  cursor: string | null,
) {
  const api = window.wintermute
  if (!api) throw new Error('请在桌面应用中连接服务。')
  return api.history({
    view,
    ...(groupId && { groupId }),
    ...(cursor && { cursor }),
  })
}

export function useHistoryPages(view: HistoryView) {
  const [pages, setPages] = useState(
    () =>
      new Map<string | null, PageState>([
        [null, { ...emptyPage, loading: true }],
      ]),
  )
  const pending = useRef(new Map<string | null, symbol>())
  const fetchPage = useCallback(
    (groupId: string | null, cursor: string | null, background = false) => {
      if (pending.current.has(groupId)) return
      const token = Symbol()
      pending.current.set(groupId, token)
      return historyPage(view, groupId, cursor)
        .then((page) => {
          if (pending.current.get(groupId) !== token) return
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
                  row.text === last.text &&
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
    [view],
  )
  useEffect(() => {
    void fetchPage(null, null)
    const requests = pending.current
    function refreshVisible() {
      if (document.visibilityState === 'visible')
        void fetchPage(null, null, true)
    }
    if (view !== 'chat') return () => requests.clear()
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
