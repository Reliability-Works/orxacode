import { type ThreadId } from '@orxa-code/contracts'

export function buildDefaultSecondaryThreadId(
  primaryThreadId: ThreadId,
  threadLastVisitedAtById: Record<string, string>,
  threadIds: ReadonlyArray<ThreadId>
): ThreadId | null {
  const candidates = threadIds.filter(threadId => threadId !== primaryThreadId)
  if (candidates.length === 0) return null
  return (
    candidates.toSorted((left, right) => {
      const leftVisitedAt = threadLastVisitedAtById[left] ?? ''
      const rightVisitedAt = threadLastVisitedAtById[right] ?? ''
      return rightVisitedAt.localeCompare(leftVisitedAt)
    })[0] ?? null
  )
}
