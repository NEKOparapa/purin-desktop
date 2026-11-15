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
    (groupId: string | null, cursor: string | null) => {
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
    return () => requests.clear()
  }, [fetchPage])
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
