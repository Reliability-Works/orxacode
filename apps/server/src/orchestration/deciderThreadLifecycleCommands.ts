import { Effect } from 'effect'
import type { OrchestrationReadModel, ThreadId } from '@orxa-code/contracts'

import {
  requireProject,
  requireThread,
  requireThreadAbsent,
  requireThreadArchived,
  requireThreadNotArchived,
} from './commandInvariants.ts'
import { nowIso } from './deciderShared.ts'
import { createThreadEvent, type ThreadCommandInput } from './deciderThreadShared.ts'

function listDescendantSubagentThreadIds(
  readModel: OrchestrationReadModel,
  parentThreadId: ThreadId
): ThreadId[] {
  const childIdsByParentId = new Map<ThreadId, ThreadId[]>()
  for (const thread of readModel.threads) {
    if (thread.parentLink?.relationKind !== 'subagent') {
      continue
    }
    const childIds = childIdsByParentId.get(thread.parentLink.parentThreadId) ?? []
    childIds.push(thread.id)
    childIdsByParentId.set(thread.parentLink.parentThreadId, childIds)
  }

  const descendantIds: ThreadId[] = []
  const queue = [...(childIdsByParentId.get(parentThreadId) ?? [])]
  while (queue.length > 0) {
    const nextChildId = queue.shift()
    if (!nextChildId) {
      continue
    }
    descendantIds.push(nextChildId)
    queue.push(...(childIdsByParentId.get(nextChildId) ?? []))
  }
  return descendantIds
}

export function decideThreadCreateCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.create'>) {
  return Effect.gen(function* () {
    yield* requireProject({
      readModel,
      command,
      projectId: command.projectId,
    })
    yield* requireThreadAbsent({
      readModel,
      command,
      threadId: command.threadId,
    })
    return createThreadEvent(command, {
      type: 'thread.created',
      occurredAt: command.createdAt,
      payload: {
        threadId: command.threadId,
        projectId: command.projectId,
        title: command.title,
        modelSelection: command.modelSelection,
        runtimeMode: command.runtimeMode,
        interactionMode: command.interactionMode,
        branch: command.branch,
        worktreePath: command.worktreePath,
        handoff: command.handoff ?? null,
        parentLink: command.parentLink ?? null,
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      },
    })
  })
}

export function decideThreadDeleteCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.delete'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    const occurredAt = nowIso()
    return createThreadEvent(command, {
      type: 'thread.deleted',
      occurredAt,
      payload: {
        threadId: command.threadId,
        deletedAt: occurredAt,
      },
    })
  })
}

export function decideThreadArchiveCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.archive'>) {
  return Effect.gen(function* () {
    yield* requireThreadNotArchived({ readModel, command, threadId: command.threadId })
    const occurredAt = nowIso()
    const archivedThreadIds = [
      command.threadId,
      ...listDescendantSubagentThreadIds(readModel, command.threadId).filter(threadId => {
        const thread = readModel.threads.find(candidate => candidate.id === threadId)
        return thread?.archivedAt === null
      }),
    ]
    return archivedThreadIds.map(threadId =>
      createThreadEvent(command, {
        type: 'thread.archived',
        occurredAt,
        payload: {
          threadId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      })
    )
  })
}

export function decideThreadUnarchiveCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.unarchive'>) {
  return Effect.gen(function* () {
    yield* requireThreadArchived({ readModel, command, threadId: command.threadId })
    const occurredAt = nowIso()
    return createThreadEvent(command, {
      type: 'thread.unarchived',
      occurredAt,
      payload: {
        threadId: command.threadId,
        updatedAt: occurredAt,
      },
    })
  })
}

export function decideThreadMetaUpdateCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.meta.update'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    const occurredAt = nowIso()
    return createThreadEvent(command, {
      type: 'thread.meta-updated',
      occurredAt,
      payload: {
        threadId: command.threadId,
        ...(command.title !== undefined ? { title: command.title } : {}),
        ...(command.modelSelection !== undefined ? { modelSelection: command.modelSelection } : {}),
        ...(command.branch !== undefined ? { branch: command.branch } : {}),
        ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
        updatedAt: occurredAt,
      },
    })
  })
}

export function decideThreadRuntimeModeSetCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.runtime-mode.set'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    const occurredAt = nowIso()
    return createThreadEvent(command, {
      type: 'thread.runtime-mode-set',
      occurredAt,
      payload: {
        threadId: command.threadId,
        runtimeMode: command.runtimeMode,
        updatedAt: occurredAt,
      },
    })
  })
}

export function decideThreadInteractionModeSetCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.interaction-mode.set'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    const occurredAt = nowIso()
    return createThreadEvent(command, {
      type: 'thread.interaction-mode-set',
      occurredAt,
      payload: {
        threadId: command.threadId,
        interactionMode: command.interactionMode,
        updatedAt: occurredAt,
      },
    })
  })
}

export function decideThreadSessionStopCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.session.stop'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    return createThreadEvent(command, {
      type: 'thread.session-stop-requested',
      occurredAt: command.createdAt,
      payload: {
        threadId: command.threadId,
        createdAt: command.createdAt,
      },
    })
  })
}

export function decideThreadSessionSetCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.session.set'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    return createThreadEvent(command, {
      type: 'thread.session-set',
      occurredAt: command.createdAt,
      payload: {
        threadId: command.threadId,
        session: command.session,
      },
    })
  })
}
