import { ApprovalRequestId, type ChatAttachment } from '@orxa-code/contracts'
import { Effect, FileSystem, Path } from 'effect'

import {
  attachmentRelativePath,
  parseAttachmentIdFromRelativePath,
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from '../../attachmentStore.ts'
import { ServerConfig } from '../../config.ts'
import type { ProjectionThreadActivity } from '../../persistence/Services/ProjectionThreadActivities.ts'
import type { ProjectionThreadMessage } from '../../persistence/Services/ProjectionThreadMessages.ts'
import type { ProjectionThreadProposedPlan } from '../../persistence/Services/ProjectionThreadProposedPlans.ts'
import type { ProjectionTurn } from '../../persistence/Services/ProjectionTurns.ts'
import type { AttachmentSideEffects } from './ProjectionPipelineTypes.ts'

const normalizeRelativeAttachmentPath = (value: string) =>
  value.replace(/^[/\\]+/, '').replace(/\\/g, '/')

const readRetainedTurnIds = (turns: ReadonlyArray<ProjectionTurn>, turnCount: number) =>
  new Set<string>(
    turns.flatMap(turn =>
      turn.turnId !== null &&
      turn.checkpointTurnCount !== null &&
      turn.checkpointTurnCount <= turnCount
        ? [turn.turnId]
        : []
    )
  )

export const materializeAttachmentsForProjection = Effect.fn('materializeAttachmentsForProjection')(
  (input: { readonly attachments: ReadonlyArray<ChatAttachment> }) =>
    Effect.succeed(input.attachments.length === 0 ? [] : input.attachments)
)

export function extractActivityRequestId(payload: unknown): ApprovalRequestId | null {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }
  const requestId = (payload as Record<string, unknown>).requestId
  return typeof requestId === 'string' ? ApprovalRequestId.makeUnsafe(requestId) : null
}

function retainTurnLinkedMessageIds(
  messages: ReadonlyArray<ProjectionThreadMessage>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number
) {
  const retainedMessageIds = new Set<string>()
  const retainedTurnIds = readRetainedTurnIds(turns, turnCount)
  for (const turn of turns) {
    if (!turn.turnId || !retainedTurnIds.has(turn.turnId)) {
      continue
    }
    if (turn.pendingMessageId !== null) {
      retainedMessageIds.add(turn.pendingMessageId)
    }
    if (turn.assistantMessageId !== null) {
      retainedMessageIds.add(turn.assistantMessageId)
    }
  }
  for (const message of messages) {
    if (message.role === 'system') {
      retainedMessageIds.add(message.messageId)
    } else if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.messageId)
    }
  }
  return { retainedMessageIds, retainedTurnIds }
}

function fillMissingMessagesByRole(input: {
  readonly messages: ReadonlyArray<ProjectionThreadMessage>
  readonly retainedMessageIds: Set<string>
  readonly retainedTurnIds: Set<string>
  readonly role: 'user' | 'assistant'
  readonly turnCount: number
}): void {
  const retainedCount = input.messages.filter(
    message => message.role === input.role && input.retainedMessageIds.has(message.messageId)
  ).length
  const missingCount = Math.max(0, input.turnCount - retainedCount)
  if (missingCount === 0) {
    return
  }

  const fallbackMessages = input.messages
    .filter(
      message =>
        message.role === input.role &&
        !input.retainedMessageIds.has(message.messageId) &&
        (message.turnId === null || input.retainedTurnIds.has(message.turnId))
    )
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.messageId.localeCompare(right.messageId)
    )
    .slice(0, missingCount)

  for (const message of fallbackMessages) {
    input.retainedMessageIds.add(message.messageId)
  }
}

export function retainProjectionMessagesAfterRevert(
  messages: ReadonlyArray<ProjectionThreadMessage>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number
): ReadonlyArray<ProjectionThreadMessage> {
  const { retainedMessageIds, retainedTurnIds } = retainTurnLinkedMessageIds(
    messages,
    turns,
    turnCount
  )
  fillMissingMessagesByRole({
    messages,
    retainedMessageIds,
    retainedTurnIds,
    role: 'user',
    turnCount,
  })
  fillMissingMessagesByRole({
    messages,
    retainedMessageIds,
    retainedTurnIds,
    role: 'assistant',
    turnCount,
  })
  return messages.filter(message => retainedMessageIds.has(message.messageId))
}

export function retainProjectionActivitiesAfterRevert(
  activities: ReadonlyArray<ProjectionThreadActivity>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number
): ReadonlyArray<ProjectionThreadActivity> {
  const retainedTurnIds = readRetainedTurnIds(turns, turnCount)
  return activities.filter(
    activity => activity.turnId === null || retainedTurnIds.has(activity.turnId)
  )
}

export function retainProjectionProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<ProjectionThreadProposedPlan>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number
): ReadonlyArray<ProjectionThreadProposedPlan> {
  const retainedTurnIds = readRetainedTurnIds(turns, turnCount)
  return proposedPlans.filter(
    proposedPlan => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId)
  )
}

export function collectThreadAttachmentRelativePaths(
  threadId: string,
  messages: ReadonlyArray<ProjectionThreadMessage>
): Set<string> {
  const threadSegment = toSafeThreadAttachmentSegment(threadId)
  if (!threadSegment) {
    return new Set()
  }
  const relativePaths = new Set<string>()
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.type !== 'image') {
        continue
      }
      const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachment.id)
      if (attachmentThreadSegment === threadSegment) {
        relativePaths.add(attachmentRelativePath(attachment))
      }
    }
  }
  return relativePaths
}

function resolveThreadAttachmentEntry(threadSegment: string, entry: string): string | null {
  const relativePath = normalizeRelativeAttachmentPath(entry)
  if (relativePath.length === 0 || relativePath.includes('/')) {
    return null
  }
  const attachmentId = parseAttachmentIdFromRelativePath(relativePath)
  const attachmentThreadSegment = attachmentId
    ? parseThreadSegmentFromAttachmentId(attachmentId)
    : null
  if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
    return null
  }
  return relativePath
}

const removeDeletedThreadAttachmentEntry = Effect.fn('removeDeletedThreadAttachmentEntry')(
  function* (threadSegment: string, entry: string, attachmentsRootDir: string) {
    const relativePath = resolveThreadAttachmentEntry(threadSegment, entry)
    if (relativePath === null) {
      return
    }

    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fileSystem.remove(path.join(attachmentsRootDir, relativePath), { force: true })
  }
)

const pruneThreadAttachmentEntry = Effect.fn('pruneThreadAttachmentEntry')(function* (
  threadSegment: string,
  keptThreadRelativePaths: Set<string>,
  entry: string,
  attachmentsRootDir: string
) {
  const relativePath = resolveThreadAttachmentEntry(threadSegment, entry)
  if (relativePath === null) {
    return
  }

  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const absolutePath = path.join(attachmentsRootDir, relativePath)
  const fileInfo = yield* fileSystem
    .stat(absolutePath)
    .pipe(Effect.catch(() => Effect.succeed(null)))
  if (!fileInfo || fileInfo.type !== 'File' || keptThreadRelativePaths.has(relativePath)) {
    return
  }

  yield* fileSystem.remove(absolutePath, { force: true })
})

export const runAttachmentSideEffects = Effect.fn('runAttachmentSideEffects')(function* (
  sideEffects: AttachmentSideEffects
) {
  const serverConfig = yield* Effect.service(ServerConfig)
  const fileSystem = yield* Effect.service(FileSystem.FileSystem)
  const attachmentsRootDir = serverConfig.attachmentsDir
  const rootEntries = yield* fileSystem
    .readDirectory(attachmentsRootDir, { recursive: false })
    .pipe(Effect.catch(() => Effect.succeed([] as Array<string>)))

  for (const threadId of sideEffects.deletedThreadIds) {
    const threadSegment = toSafeThreadAttachmentSegment(threadId)
    if (!threadSegment) {
      yield* Effect.logWarning('skipping attachment cleanup for unsafe thread id', { threadId })
      continue
    }
    yield* Effect.forEach(
      rootEntries,
      entry => removeDeletedThreadAttachmentEntry(threadSegment, entry, attachmentsRootDir),
      { concurrency: 1 }
    )
  }

  for (const [
    threadId,
    keptThreadRelativePaths,
  ] of sideEffects.prunedThreadRelativePaths.entries()) {
    if (sideEffects.deletedThreadIds.has(threadId)) {
      continue
    }
    const threadSegment = toSafeThreadAttachmentSegment(threadId)
    if (!threadSegment) {
      yield* Effect.logWarning('skipping attachment prune for unsafe thread id', { threadId })
      continue
    }
    yield* Effect.forEach(
      rootEntries,
      entry =>
        pruneThreadAttachmentEntry(
          threadSegment,
          keptThreadRelativePaths,
          entry,
          attachmentsRootDir
        ),
      { concurrency: 1 }
    )
  }
})
