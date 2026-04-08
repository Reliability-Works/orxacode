/**
 * Generic helpers for projecting thread reverts. These operate on minimal
 * structural types so the same logic can run against the server-side
 * `OrchestrationMessage`/`OrchestrationThreadActivity` types and the
 * client-side `ChatMessage`/`Thread["activities"][number]` types without
 * pulling either schema in here.
 *
 * TODO(slice-J): Migrate `apps/web/src/store.helpers.ts` to consume these
 * helpers so the cross-boundary duplication finally collapses on both sides.
 */

export interface RevertMessageLike {
  readonly id: string
  readonly role: 'user' | 'assistant' | 'system'
  readonly turnId?: string | null | undefined
  readonly createdAt: string
}

export interface RevertActivityLike {
  readonly id: string
  readonly createdAt: string
  readonly sequence?: number | undefined
}

export function addFallbackMessagesForRole<M extends RevertMessageLike>(
  messages: ReadonlyArray<M>,
  role: 'user' | 'assistant',
  retainedMessageIds: Set<string>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number
): void {
  const retainedCount = messages.filter(
    message => message.role === role && retainedMessageIds.has(message.id)
  ).length
  const missingCount = Math.max(0, turnCount - retainedCount)
  if (missingCount === 0) return
  const fallback = messages
    .filter(
      message =>
        message.role === role &&
        !retainedMessageIds.has(message.id) &&
        (message.turnId === undefined ||
          message.turnId === null ||
          retainedTurnIds.has(message.turnId))
    )
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    )
    .slice(0, missingCount)
  for (const message of fallback) {
    retainedMessageIds.add(message.id)
  }
}

export function retainThreadMessageIdsAfterRevert<M extends RevertMessageLike>(
  messages: ReadonlyArray<M>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number
): Set<string> {
  const retainedMessageIds = new Set<string>()
  for (const message of messages) {
    if (message.role === 'system') {
      retainedMessageIds.add(message.id)
      continue
    }
    if (
      message.turnId !== undefined &&
      message.turnId !== null &&
      retainedTurnIds.has(message.turnId)
    ) {
      retainedMessageIds.add(message.id)
    }
  }
  addFallbackMessagesForRole(messages, 'user', retainedMessageIds, retainedTurnIds, turnCount)
  addFallbackMessagesForRole(messages, 'assistant', retainedMessageIds, retainedTurnIds, turnCount)
  return retainedMessageIds
}

export function compareActivitiesBySequenceThenCreatedAt<A extends RevertActivityLike>(
  left: A,
  right: A
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence
    }
  } else if (left.sequence !== undefined) {
    return 1
  } else if (right.sequence !== undefined) {
    return -1
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}
