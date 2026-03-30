import type { WebContentsView } from 'electron'
import type { BrowserTab } from '../../shared/ipc'
import { isAllowedBrowserUrl } from './browser-controller-utils'

export const DEFAULT_NEW_TAB_URL = 'about:blank'

export type BrowserTabRecord = {
  id: string
  view: WebContentsView
  lastNavigatedAt?: number
  lastActivityAt: number
}

export function titleForRecord(record: BrowserTabRecord): string {
  const title = record.view.webContents.getTitle().trim()
  if (title.length > 0) {
    return title
  }

  const url = record.view.webContents.getURL()
  if (url.trim().length > 0) {
    return url
  }

  return 'New Tab'
}

export function snapshotTab(record: BrowserTabRecord): BrowserTab {
  const webContents = record.view.webContents
  const url = webContents.getURL()

  return {
    id: record.id,
    url: isAllowedBrowserUrl(url) ? url : DEFAULT_NEW_TAB_URL,
    title: titleForRecord(record),
    loading: webContents.isLoading(),
    canGoBack: webContents.navigationHistory?.canGoBack?.() ?? false,
    canGoForward: webContents.navigationHistory?.canGoForward?.() ?? false,
    lastNavigatedAt: record.lastNavigatedAt,
  }
}

export function resolveTabID(
  tabID: string | undefined,
  activeTabID: string | undefined,
  tabs: Map<string, BrowserTabRecord>
) {
  if (tabID) {
    if (!tabs.has(tabID)) {
      throw new Error('Browser tab not found')
    }
    return tabID
  }

  return activeTabID
}

export function requireTab(
  tabID: string | undefined,
  activeTabID: string | undefined,
  tabs: Map<string, BrowserTabRecord>
) {
  const resolvedTabID = resolveTabID(tabID, activeTabID, tabs)
  if (!resolvedTabID) {
    throw new Error('No browser tab is active')
  }

  const record = tabs.get(resolvedTabID)
  if (!record) {
    throw new Error('Browser tab not found')
  }

  return record
}
