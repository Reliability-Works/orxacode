import type { OrchestrationEvent, ProviderRuntimeEvent, ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'

import { checkpointRefForThreadTurn } from '../../checkpointing/Utils.ts'
import type { CheckpointStoreShape } from '../../checkpointing/Services/CheckpointStore.ts'
import type { OrchestrationEngineShape } from '../Services/OrchestrationEngine.ts'
import type { RuntimeReceiptBusShape } from '../Services/RuntimeReceiptBus.ts'
import type {
  CheckpointReactorReadProject,
  CheckpointReactorReadThread,
  CheckpointSessionRuntimeResolver,
} from './CheckpointReactor.shared.ts'
import { resolveCheckpointWorkspaceCwd, resolveTurnContext } from './CheckpointReactor.shared.ts'

function currentCheckpointTurnCount(
  thread: Pick<CheckpointReactorReadThread, 'checkpoints'>
): number {
  return thread.checkpoints.reduce(
    (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
    0
  )
}

export function resolveCheckpointCwdForThread(input: {
  readonly resolveSessionRuntimeForThread: CheckpointSessionRuntimeResolver
  readonly threadId: ThreadId
  readonly thread: Pick<CheckpointReactorReadThread, 'projectId' | 'worktreePath'>
  readonly projects: ReadonlyArray<Pick<CheckpointReactorReadProject, 'id' | 'workspaceRoot'>>
  readonly preferSessionRuntime: boolean
}) {
  return Effect.gen(function* () {
    const sessionRuntime = yield* input.resolveSessionRuntimeForThread(input.threadId)
    return resolveCheckpointWorkspaceCwd({
      threadId: input.threadId,
      thread: input.thread,
      projects: input.projects,
      sessionRuntime,
      preferSessionRuntime: input.preferSessionRuntime,
    })
  })
}

function createEnsureBaselineCheckpoint(input: {
  readonly checkpointStore: CheckpointStoreShape
  readonly receiptBus: RuntimeReceiptBusShape
}) {
  return Effect.fnUntraced(function* (payload: {
    readonly threadId: ThreadId
    readonly cwd: string
    readonly currentTurnCount: number
    readonly createdAt: string
  }) {
    const baselineCheckpointRef = checkpointRefForThreadTurn(
      payload.threadId,
      payload.currentTurnCount
    )
    const baselineExists = yield* input.checkpointStore.hasCheckpointRef({
      cwd: payload.cwd,
      checkpointRef: baselineCheckpointRef,
    })
    if (baselineExists) {
      return
    }

    yield* input.checkpointStore.captureCheckpoint({
      cwd: payload.cwd,
      checkpointRef: baselineCheckpointRef,
    })
    yield* input.receiptBus.publish({
      type: 'checkpoint.baseline.captured',
      threadId: payload.threadId,
      checkpointTurnCount: payload.currentTurnCount,
      checkpointRef: baselineCheckpointRef,
      createdAt: payload.createdAt,
    })
  })
}

function createEnsurePreTurnBaselineFromTurnStart(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly resolveSessionRuntimeForThread: CheckpointSessionRuntimeResolver
  readonly ensureBaselineCheckpoint: ReturnType<typeof createEnsureBaselineCheckpoint>
}) {
  return Effect.fnUntraced(function* (
    event: Extract<ProviderRuntimeEvent, { type: 'turn.started' }>
  ) {
    const context = yield* resolveTurnContext({
      orchestrationEngine: input.orchestrationEngine,
      threadId: event.threadId,
      turnIdRaw: event.turnId,
    })
    if (!context) {
      return
    }
    const { thread, readModel } = context

    const checkpointCwd = yield* resolveCheckpointCwdForThread({
      resolveSessionRuntimeForThread: input.resolveSessionRuntimeForThread,
      threadId: thread.id,
      thread,
      projects: readModel.projects,
      preferSessionRuntime: false,
    })
    if (!checkpointCwd) {
      return
    }

    yield* input.ensureBaselineCheckpoint({
      threadId: thread.id,
      cwd: checkpointCwd,
      currentTurnCount: currentCheckpointTurnCount(thread),
      createdAt: event.createdAt,
    })
  })
}

function createEnsurePreTurnBaselineFromDomainTurnStart(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly resolveSessionRuntimeForThread: CheckpointSessionRuntimeResolver
  readonly ensureBaselineCheckpoint: ReturnType<typeof createEnsureBaselineCheckpoint>
}) {
  return Effect.fnUntraced(function* (
    event: Extract<
      OrchestrationEvent,
      { type: 'thread.turn-start-requested' | 'thread.message-sent' }
    >
  ) {
    if (
      event.type === 'thread.message-sent' &&
      (event.payload.role !== 'user' || event.payload.streaming || event.payload.turnId !== null)
    ) {
      return
    }

    const readModel = yield* input.orchestrationEngine.getReadModel()
    const thread = readModel.threads.find(entry => entry.id === event.payload.threadId)
    if (!thread) {
      return
    }

    const checkpointCwd = yield* resolveCheckpointCwdForThread({
      resolveSessionRuntimeForThread: input.resolveSessionRuntimeForThread,
      threadId: event.payload.threadId,
      thread,
      projects: readModel.projects,
      preferSessionRuntime: false,
    })
    if (!checkpointCwd) {
      return
    }

    yield* input.ensureBaselineCheckpoint({
      threadId: event.payload.threadId,
      cwd: checkpointCwd,
      currentTurnCount: currentCheckpointTurnCount(thread),
      createdAt: event.type === 'thread.message-sent' ? event.occurredAt : event.payload.createdAt,
    })
  })
}

export function createCheckpointBaselineHandlers(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly checkpointStore: CheckpointStoreShape
  readonly receiptBus: RuntimeReceiptBusShape
  readonly resolveSessionRuntimeForThread: CheckpointSessionRuntimeResolver
}) {
  const ensureBaselineCheckpoint = createEnsureBaselineCheckpoint({
    checkpointStore: input.checkpointStore,
    receiptBus: input.receiptBus,
  })

  return {
    ensurePreTurnBaselineFromTurnStart: createEnsurePreTurnBaselineFromTurnStart({
      orchestrationEngine: input.orchestrationEngine,
      resolveSessionRuntimeForThread: input.resolveSessionRuntimeForThread,
      ensureBaselineCheckpoint,
    }),
    ensurePreTurnBaselineFromDomainTurnStart: createEnsurePreTurnBaselineFromDomainTurnStart({
      orchestrationEngine: input.orchestrationEngine,
      resolveSessionRuntimeForThread: input.resolveSessionRuntimeForThread,
      ensureBaselineCheckpoint,
    }),
  }
}
