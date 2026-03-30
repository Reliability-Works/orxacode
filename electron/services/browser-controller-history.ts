import type { BrowserHistoryItem, OrxaEvent } from '../../shared/ipc'
import { isAllowedBrowserUrl } from './browser-controller-utils'
import { DEFAULT_NEW_TAB_URL } from './browser-controller-tabs'

type BrowserHistoryStore = {
  get: (key: 'items', defaultValue: BrowserHistoryItem[]) => BrowserHistoryItem[]
  set: (key: 'items', value: BrowserHistoryItem[]) => void
}

export function readHistory(historyStore: BrowserHistoryStore): BrowserHistoryItem[] {
  const value = historyStore.get('items', [])
  if (!Array.isArray(value)) {
    return []
  }
  return value
}

export function recordHistoryEntry({
  url,
  title,
  historyStore,
  historyLimit,
  now,
  createID,
  emit,
}: {
  url: string
  title: string
  historyStore: BrowserHistoryStore
  historyLimit: number
  now: () => number
  createID: () => string
  emit: (event: OrxaEvent) => void
}) {
  if (!isAllowedBrowserUrl(url) || url === DEFAULT_NEW_TAB_URL) {
    return
  }

  const items = readHistory(historyStore)
  const visitedAt = now()

  if (items.length > 0 && items[0]?.url === url) {
    const updated = { ...items[0], title, visitedAt }
    historyStore.set('items', [updated, ...items.slice(1, historyLimit)])
    emit({ type: 'browser.history.added', payload: updated })
    return
  }

  const entry: BrowserHistoryItem = {
    id: createID(),
    url,
    title,
    visitedAt,
  }

  historyStore.set('items', [entry, ...items].slice(0, historyLimit))
  emit({ type: 'browser.history.added', payload: entry })
}
