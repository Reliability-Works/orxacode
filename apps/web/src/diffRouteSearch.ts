import { ThreadId } from '@orxa-code/contracts'

export interface DiffRouteSearch {
  split?: '1' | undefined
  secondaryThreadId?: ThreadId | undefined
  focusedPane?: 'primary' | 'secondary' | undefined
  maximizedPane?: 'primary' | 'secondary' | undefined
}

function isOpenValue(value: unknown): boolean {
  return value === '1' || value === 1 || value === true
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function parseSplitRouteSearch(search: Record<string, unknown>) {
  const split: '1' | undefined = isOpenValue(search.split) ? '1' : undefined
  const secondaryThreadIdRaw = split ? normalizeSearchString(search.secondaryThreadId) : undefined
  const focusedPane: DiffRouteSearch['focusedPane'] =
    split && (search.focusedPane === 'primary' || search.focusedPane === 'secondary')
      ? search.focusedPane
      : undefined
  const maximizedPane: DiffRouteSearch['maximizedPane'] =
    split && (search.maximizedPane === 'primary' || search.maximizedPane === 'secondary')
      ? search.maximizedPane
      : undefined
  return {
    split,
    secondaryThreadId: secondaryThreadIdRaw ? ThreadId.makeUnsafe(secondaryThreadIdRaw) : undefined,
    focusedPane,
    maximizedPane,
  }
}

export function stripDiffSearchParams<T extends Record<string, unknown>>(
  params: T
): Omit<T, 'split' | 'secondaryThreadId' | 'focusedPane' | 'maximizedPane'> & {
  split: undefined
  secondaryThreadId: undefined
  focusedPane: undefined
  maximizedPane: undefined
} {
  // Explicit undefined values (rather than deleted keys) are required so the
  // route's `retainSearchParams` middleware treats these as "cleared by the
  // user" and does not re-populate them from the prior URL.
  return {
    ...params,
    split: undefined,
    secondaryThreadId: undefined,
    focusedPane: undefined,
    maximizedPane: undefined,
  } as Omit<T, 'split' | 'secondaryThreadId' | 'focusedPane' | 'maximizedPane'> & {
    split: undefined
    secondaryThreadId: undefined
    focusedPane: undefined
    maximizedPane: undefined
  }
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const splitSearch = parseSplitRouteSearch(search)

  return {
    ...(splitSearch.split ? { split: splitSearch.split } : {}),
    ...(splitSearch.secondaryThreadId ? { secondaryThreadId: splitSearch.secondaryThreadId } : {}),
    ...(splitSearch.focusedPane ? { focusedPane: splitSearch.focusedPane } : {}),
    ...(splitSearch.maximizedPane ? { maximizedPane: splitSearch.maximizedPane } : {}),
  }
}
