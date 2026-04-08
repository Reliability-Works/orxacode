import type { CheckpointRef, CommandId, OrchestrationEvent, ThreadId } from '@orxa-code/contracts'
import { Effect, Option } from 'effect'

import type { CheckpointStoreShape } from '../../checkpointing/Services/CheckpointStore.ts'
import type { ProviderServiceShape } from '../../provider/Services/ProviderService.ts'
import type { OrchestrationEngineShape } from '../Services/OrchestrationEngine.ts'
import type { WorkspaceEntriesShape } from '../../workspace/Services/WorkspaceEntries.ts'
import {
  currentCheckpointTurnCount,
  type CheckpointSessionRuntimeResolver,
} from './CheckpointReactor.shared.ts'
import { checkpointRefForThreadTurn } from '../../checkpointing/Utils.ts'

function appendRevertFailureSafely(
  appendRevertFailureActivity: (input: {
    readonly threadId: ThreadId
    readonly turnCount: number
    readonly detail: string
    readonly createdAt: string
  }) => ReturnType<OrchestrationEngineShape['dispatch']>,
  input: {
    readonly threadId: ThreadId
    readonly turnCount: number
    readonly detail: string
    readonly createdAt: string
  }
) {
  return appendRevertFailureActivity(input).pipe(Effect.catch(() => Effect.void))
}

function resolveTargetCheckpointRef(input: {
  readonly event: Extract<OrchestrationEvent, { type: 'thread.checkpoint-revert-requested' }>
  readonly thread: {
    readonly checkpoints: ReadonlyArray<{
      readonly checkpointTurnCount: number
      readonly checkpointRef: CheckpointRef
    }>
  }
}) {
  return input.event.payload.turnCount === 0
    ? checkpointRefForThreadTurn(input.event.payload.threadId, 0)
    : input.thread.checkpoints.find(
        checkpoint => checkpoint.checkpointTurnCount === input.event.payload.turnCount
      )?.checkpointRef
}

function pruneStaleCheckpointRefs(input: {
  readonly checkpointStore: CheckpointStoreShape
  readonly cwd: string
  readonly thread: {
    readonly checkpoints: ReadonlyArray<{
      readonly checkpointTurnCount: number
      readonly checkpointRef: CheckpointRef
    }>
  }
  readonly turnCount: number
}) {
  const staleCheckpointRefs = input.thread.checkpoints
    .filter(checkpoint => checkpoint.checkpointTurnCount > input.turnCount)
    .map(checkpoint => checkpoint.checkpointRef)
  if (staleCheckpointRefs.length === 0) {
    return Effect.void
  }
  return input.checkpointStore.deleteCheckpointRefs({
    cwd: input.cwd,
    checkpointRefs: staleCheckpointRefs,
  })
}

function completeRevert(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly appendRevertFailureActivity: (payload: {
    readonly threadId: ThreadId
    readonly turnCount: number
    readonly detail: string
    readonly createdAt: string
  }) => ReturnType<OrchestrationEngineShape['dispatch']>
  readonly serverCommandId: (tag: string) => CommandId
  readonly threadId: ThreadId
  readonly turnCount: number
  readonly createdAt: string
}) {
  return input.orchestrationEngine
    .dispatch({
      type: 'thread.revert.complete',
      commandId: input.serverCommandId('checkpoint-revert-complete'),
      threadId: input.threadId,
      turnCount: input.turnCount,
      createdAt: input.createdAt,
    })
    .pipe(
      Effect.catch(error =>
        input.appendRevertFailureActivity({
          threadId: input.threadId,
          turnCount: input.turnCount,
          detail: error.message,
          createdAt: input.createdAt,
        })
      ),
      Effect.asVoid
    )
}

function resolveRevertContext(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly resolveSessionRuntimeForThread: CheckpointSessionRuntimeResolver
  readonly isGitWorkspace: (cwd: string) => boolean
  readonly event: Extract<OrchestrationEvent, { type: 'thread.checkpoint-revert-requested' }>
  readonly createdAt: string
}) {
  return Effect.gen(function* () {
    const readModel = yield* input.orchestrationEngine.getReadModel()
    const thread = readModel.threads.find(entry => entry.id === input.event.payload.threadId)
    if (!thread) {
      return { detail: 'Thread was not found in read model.' } as const
    }

    const sessionRuntime = yield* input.resolveSessionRuntimeForThread(input.event.payload.threadId)
    if (Option.isNone(sessionRuntime)) {
      return {
        detail: 'No active provider session with workspace cwd is bound to this thread.',
      } as const
    }
    if (!input.isGitWorkspace(sessionRuntime.value.cwd)) {
      return {
        detail: 'Checkpoints are unavailable because this project is not a git repository.',
      } as const
    }

    const currentTurnCount = currentCheckpointTurnCount(thread)
    if (input.event.payload.turnCount > currentTurnCount) {
      return {
        detail: `Checkpoint turn count ${input.event.payload.turnCount} exceeds current turn count ${currentTurnCount}.`,
      } as const
    }

    const targetCheckpointRef = resolveTargetCheckpointRef({ event: input.event, thread })
    if (!targetCheckpointRef) {
      return {
        detail: `Checkpoint ref for turn ${input.event.payload.turnCount} is unavailable in read model.`,
      } as const
    }

    return {
      thread,
      sessionRuntime: sessionRuntime.value,
      currentTurnCount,
      targetCheckpointRef,
    } as const
  })
}

function restoreCheckpointForRevert(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly providerService: ProviderServiceShape
  readonly checkpointStore: CheckpointStoreShape
  readonly workspaceEntries: WorkspaceEntriesShape
  readonly resolveSessionRuntimeForThread: CheckpointSessionRuntimeResolver
  readonly appendRevertFailureActivity: (payload: {
    readonly threadId: ThreadId
    readonly turnCount: number
    readonly detail: string
    readonly createdAt: string
  }) => ReturnType<OrchestrationEngineShape['dispatch']>
  readonly isGitWorkspace: (cwd: string) => boolean
  readonly serverCommandId: (tag: string) => CommandId
}) {
  return Effect.fnUntraced(function* (
    event: Extract<OrchestrationEvent, { type: 'thread.checkpoint-revert-requested' }>
  ) {
    const now = new Date().toISOString()
    const context = yield* resolveRevertContext({
      orchestrationEngine: input.orchestrationEngine,
      resolveSessionRuntimeForThread: input.resolveSessionRuntimeForThread,
      isGitWorkspace: input.isGitWorkspace,
      event,
      createdAt: now,
    })
    if ('detail' in context) {
      yield* appendRevertFailureSafely(input.appendRevertFailureActivity, {
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: context.detail,
        createdAt: now,
      })
      return
    }

    const restored = yield* input.checkpointStore.restoreCheckpoint({
      cwd: context.sessionRuntime.cwd,
      checkpointRef: context.targetCheckpointRef,
      fallbackToHead: event.payload.turnCount === 0,
    })
    if (!restored) {
      yield* appendRevertFailureSafely(input.appendRevertFailureActivity, {
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: `Filesystem checkpoint is unavailable for turn ${event.payload.turnCount}.`,
        createdAt: now,
      })
      return
    }

    yield* input.workspaceEntries.invalidate(context.sessionRuntime.cwd)

    const rolledBackTurns = Math.max(0, context.currentTurnCount - event.payload.turnCount)
    if (rolledBackTurns > 0) {
      yield* input.providerService.rollbackConversation({
        threadId: context.sessionRuntime.threadId,
        numTurns: rolledBackTurns,
      })
    }

    yield* pruneStaleCheckpointRefs({
      checkpointStore: input.checkpointStore,
      cwd: context.sessionRuntime.cwd,
      thread: context.thread,
      turnCount: event.payload.turnCount,
    })
    yield* completeRevert({
      orchestrationEngine: input.orchestrationEngine,
      appendRevertFailureActivity: input.appendRevertFailureActivity,
      serverCommandId: input.serverCommandId,
      threadId: event.payload.threadId,
      turnCount: event.payload.turnCount,
      createdAt: now,
    })
  })
}

export function createHandleRevertRequested(
  input: Parameters<typeof restoreCheckpointForRevert>[0]
) {
  return restoreCheckpointForRevert(input)
}
