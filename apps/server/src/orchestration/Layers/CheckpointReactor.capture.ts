import {
  type CheckpointRef,
  EventId,
  MessageId,
  type OrchestrationEvent,
  type ProviderRuntimeEvent,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { Effect } from 'effect'
import { parseTurnDiffFilesFromUnifiedDiff } from '../../checkpointing/Diffs.ts'
import { checkpointRefForThreadTurn } from '../../checkpointing/Utils.ts'
import type { CheckpointStoreShape } from '../../checkpointing/Services/CheckpointStore.ts'
import type { OrchestrationEngineShape } from '../Services/OrchestrationEngine.ts'
import type { RuntimeReceiptBusShape } from '../Services/RuntimeReceiptBus.ts'
import type { WorkspaceEntriesShape } from '../../workspace/Services/WorkspaceEntries.ts'
import {
  createCheckpointBaselineHandlers,
  resolveCheckpointCwdForThread,
} from './CheckpointReactor.baseline.ts'
import {
  checkpointStatusFromRuntime,
  currentCheckpointTurnCount,
  type CheckpointReactorReadThread,
  serverCommandId,
  sameId,
  toTurnId,
  resolveTurnContext,
  type CheckpointSessionRuntimeResolver,
  type createAppendCaptureFailureActivity,
} from './CheckpointReactor.shared.ts'
function resolveAssistantMessageId(input: {
  readonly thread: Pick<CheckpointReactorReadThread, 'messages'>
  readonly turnId: TurnId
  readonly assistantMessageId: MessageId | undefined
}) {
  return (
    input.assistantMessageId ??
    input.thread.messages
      .toReversed()
      .find(entry => entry.role === 'assistant' && entry.turnId === input.turnId)?.id ??
    MessageId.makeUnsafe(`assistant:${input.turnId}`)
  )
}
function deriveCheckpointFiles(input: {
  readonly checkpointStore: CheckpointStoreShape
  readonly appendCaptureFailureActivity: ReturnType<typeof createAppendCaptureFailureActivity>
  readonly threadId: ThreadId
  readonly turnId: TurnId
  readonly cwd: string
  readonly fromCheckpointRef: CheckpointRef
  readonly toCheckpointRef: CheckpointRef
  readonly turnCount: number
  readonly createdAt: string
}) {
  return input.checkpointStore
    .diffCheckpoints({
      cwd: input.cwd,
      fromCheckpointRef: input.fromCheckpointRef,
      toCheckpointRef: input.toCheckpointRef,
      fallbackFromToHead: false,
    })
    .pipe(
      Effect.map(diff =>
        parseTurnDiffFilesFromUnifiedDiff(diff).map(file => ({
          path: file.path,
          kind: 'modified' as const,
          additions: file.additions,
          deletions: file.deletions,
        }))
      ),
      Effect.tapError(error =>
        input.appendCaptureFailureActivity({
          threadId: input.threadId,
          turnId: input.turnId,
          detail: `Checkpoint captured, but turn diff summary is unavailable: ${error.message}`,
          createdAt: input.createdAt,
        })
      ),
      Effect.catch(error =>
        Effect.logWarning('failed to derive checkpoint file summary', {
          threadId: input.threadId,
          turnId: input.turnId,
          turnCount: input.turnCount,
          detail: error.message,
        }).pipe(Effect.as([]))
      )
    )
}
function publishCheckpointReceipts(input: {
  readonly receiptBus: RuntimeReceiptBusShape
  readonly threadId: ThreadId
  readonly turnId: TurnId
  readonly turnCount: number
  readonly checkpointRef: CheckpointRef
  readonly status: 'ready' | 'missing' | 'error'
  readonly createdAt: string
}) {
  return Effect.all([
    input.receiptBus.publish({
      type: 'checkpoint.diff.finalized',
      threadId: input.threadId,
      turnId: input.turnId,
      checkpointTurnCount: input.turnCount,
      checkpointRef: input.checkpointRef,
      status: input.status,
      createdAt: input.createdAt,
    }),
    input.receiptBus.publish({
      type: 'turn.processing.quiesced',
      threadId: input.threadId,
      turnId: input.turnId,
      checkpointTurnCount: input.turnCount,
      createdAt: input.createdAt,
    }),
  ])
}
function dispatchCheckpointCapturedActivity(
  orchestrationEngine: OrchestrationEngineShape,
  input: {
    readonly threadId: ThreadId
    readonly turnId: TurnId
    readonly turnCount: number
    readonly status: 'ready' | 'missing' | 'error'
    readonly createdAt: string
  }
) {
  return orchestrationEngine.dispatch({
    type: 'thread.activity.append',
    commandId: serverCommandId('checkpoint-captured-activity'),
    threadId: input.threadId,
    activity: {
      id: EventId.makeUnsafe(crypto.randomUUID()),
      tone: 'info',
      kind: 'checkpoint.captured',
      summary: 'Checkpoint captured',
      payload: {
        turnCount: input.turnCount,
        status: input.status,
      },
      turnId: input.turnId,
      createdAt: input.createdAt,
    },
    createdAt: input.createdAt,
  })
}
function dispatchTurnDiffComplete(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly threadId: ThreadId
  readonly turnId: TurnId
  readonly targetCheckpointRef: CheckpointRef
  readonly status: 'ready' | 'missing' | 'error'
  readonly files: ReadonlyArray<{
    readonly path: string
    readonly kind: 'modified'
    readonly additions: number
    readonly deletions: number
  }>
  readonly assistantMessageId: MessageId
  readonly turnCount: number
  readonly createdAt: string
}) {
  return input.orchestrationEngine.dispatch({
    type: 'thread.turn.diff.complete',
    commandId: serverCommandId('checkpoint-turn-diff-complete'),
    threadId: input.threadId,
    turnId: input.turnId,
    completedAt: input.createdAt,
    checkpointRef: input.targetCheckpointRef,
    status: input.status,
    files: input.files,
    assistantMessageId: input.assistantMessageId,
    checkpointTurnCount: input.turnCount,
    createdAt: input.createdAt,
  })
}
function checkpointRefsForTurn(threadId: ThreadId, turnCount: number) {
  const fromTurnCount = Math.max(0, turnCount - 1)
  return {
    fromTurnCount,
    fromCheckpointRef: checkpointRefForThreadTurn(threadId, fromTurnCount),
    targetCheckpointRef: checkpointRefForThreadTurn(threadId, turnCount),
  }
}
function ensureCheckpointCaptured(input: {
  readonly checkpointStore: CheckpointStoreShape
  readonly workspaceEntries: WorkspaceEntriesShape
  readonly threadId: ThreadId
  readonly turnId: TurnId
  readonly cwd: string
  readonly fromTurnCount: number
  readonly fromCheckpointRef: CheckpointRef
  readonly targetCheckpointRef: CheckpointRef
}) {
  return Effect.gen(function* () {
    const fromCheckpointExists = yield* input.checkpointStore.hasCheckpointRef({
      cwd: input.cwd,
      checkpointRef: input.fromCheckpointRef,
    })
    if (!fromCheckpointExists) {
      yield* Effect.logWarning('checkpoint capture missing pre-turn baseline', {
        threadId: input.threadId,
        turnId: input.turnId,
        fromTurnCount: input.fromTurnCount,
      })
    }
    yield* input.checkpointStore.captureCheckpoint({
      cwd: input.cwd,
      checkpointRef: input.targetCheckpointRef,
    })
    yield* input.workspaceEntries.invalidate(input.cwd)
  })
}
function createCaptureAndDispatchCheckpoint(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly checkpointStore: CheckpointStoreShape
  readonly receiptBus: RuntimeReceiptBusShape
  readonly workspaceEntries: WorkspaceEntriesShape
  readonly appendCaptureFailureActivity: ReturnType<typeof createAppendCaptureFailureActivity>
}) {
  return Effect.fnUntraced(function* (payload: {
    readonly threadId: ThreadId
    readonly turnId: TurnId
    readonly thread: Pick<CheckpointReactorReadThread, 'messages'>
    readonly cwd: string
    readonly turnCount: number
    readonly status: 'ready' | 'missing' | 'error'
    readonly assistantMessageId: MessageId | undefined
    readonly createdAt: string
  }) {
    const { fromTurnCount, fromCheckpointRef, targetCheckpointRef } = checkpointRefsForTurn(
      payload.threadId,
      payload.turnCount
    )
    yield* ensureCheckpointCaptured({
      checkpointStore: input.checkpointStore,
      workspaceEntries: input.workspaceEntries,
      threadId: payload.threadId,
      turnId: payload.turnId,
      cwd: payload.cwd,
      fromTurnCount,
      fromCheckpointRef,
      targetCheckpointRef,
    })

    const files = yield* deriveCheckpointFiles({
      checkpointStore: input.checkpointStore,
      appendCaptureFailureActivity: input.appendCaptureFailureActivity,
      threadId: payload.threadId,
      turnId: payload.turnId,
      cwd: payload.cwd,
      fromCheckpointRef,
      toCheckpointRef: targetCheckpointRef,
      turnCount: payload.turnCount,
      createdAt: payload.createdAt,
    })
    const assistantMessageId = resolveAssistantMessageId({ ...payload })
    yield* dispatchTurnDiffComplete({
      orchestrationEngine: input.orchestrationEngine,
      threadId: payload.threadId,
      turnId: payload.turnId,
      targetCheckpointRef,
      status: payload.status,
      files,
      assistantMessageId,
      turnCount: payload.turnCount,
      createdAt: payload.createdAt,
    })
    yield* publishCheckpointReceipts({
      receiptBus: input.receiptBus,
      threadId: payload.threadId,
      turnId: payload.turnId,
      turnCount: payload.turnCount,
      checkpointRef: targetCheckpointRef,
      status: payload.status,
      createdAt: payload.createdAt,
    })
    yield* dispatchCheckpointCapturedActivity(input.orchestrationEngine, {
      threadId: payload.threadId,
      turnId: payload.turnId,
      turnCount: payload.turnCount,
      status: payload.status,
      createdAt: payload.createdAt,
    })
  })
}
function createCaptureCheckpointFromTurnCompletion(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly resolveSessionRuntimeForThread: CheckpointSessionRuntimeResolver
  readonly captureAndDispatchCheckpoint: ReturnType<typeof createCaptureAndDispatchCheckpoint>
}) {
  return Effect.fnUntraced(function* (
    event: Extract<ProviderRuntimeEvent, { type: 'turn.completed' }>
  ) {
    const context = yield* resolveTurnContext({
      orchestrationEngine: input.orchestrationEngine,
      threadId: event.threadId,
      turnIdRaw: event.turnId,
    })
    if (!context) {
      return
    }
    const { turnId, thread, readModel } = context

    if (thread.session?.activeTurnId && !sameId(thread.session.activeTurnId, turnId)) {
      return
    }
    if (
      thread.checkpoints.some(
        checkpoint => checkpoint.turnId === turnId && checkpoint.status !== 'missing'
      )
    ) {
      return
    }

    const checkpointCwd = yield* resolveCheckpointCwdForThread({
      resolveSessionRuntimeForThread: input.resolveSessionRuntimeForThread,
      threadId: thread.id,
      thread,
      projects: readModel.projects,
      preferSessionRuntime: true,
    })
    if (!checkpointCwd) {
      return
    }

    const existingPlaceholder = thread.checkpoints.find(
      checkpoint => checkpoint.turnId === turnId && checkpoint.status === 'missing'
    )
    yield* input.captureAndDispatchCheckpoint({
      threadId: thread.id,
      turnId,
      thread,
      cwd: checkpointCwd,
      turnCount: existingPlaceholder?.checkpointTurnCount ?? currentCheckpointTurnCount(thread) + 1,
      status: checkpointStatusFromRuntime(event.payload.state),
      assistantMessageId: undefined,
      createdAt: event.createdAt,
    })
  })
}
function createCaptureCheckpointFromPlaceholder(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly resolveSessionRuntimeForThread: CheckpointSessionRuntimeResolver
  readonly captureAndDispatchCheckpoint: ReturnType<typeof createCaptureAndDispatchCheckpoint>
}) {
  return Effect.fnUntraced(function* (
    event: Extract<OrchestrationEvent, { type: 'thread.turn-diff-completed' }>
  ) {
    const { threadId, turnId, checkpointTurnCount, status } = event.payload
    if (status !== 'missing') {
      return
    }

    const readModel = yield* input.orchestrationEngine.getReadModel()
    const thread = readModel.threads.find(entry => entry.id === threadId)
    if (!thread) {
      yield* Effect.logWarning('checkpoint capture from placeholder skipped: thread not found', {
        threadId,
      })
      return
    }
    if (
      thread.checkpoints.some(
        checkpoint => checkpoint.turnId === turnId && checkpoint.status !== 'missing'
      )
    ) {
      yield* Effect.logDebug(
        'checkpoint capture from placeholder skipped: real checkpoint already exists',
        { threadId, turnId }
      )
      return
    }

    const checkpointCwd = yield* resolveCheckpointCwdForThread({
      resolveSessionRuntimeForThread: input.resolveSessionRuntimeForThread,
      threadId,
      thread,
      projects: readModel.projects,
      preferSessionRuntime: true,
    })
    if (!checkpointCwd) {
      return
    }

    yield* input.captureAndDispatchCheckpoint({
      threadId,
      turnId,
      thread,
      cwd: checkpointCwd,
      turnCount: checkpointTurnCount,
      status: 'ready',
      assistantMessageId: event.payload.assistantMessageId ?? undefined,
      createdAt: event.payload.completedAt,
    })
  })
}
function createProcessRuntimeEvent(input: {
  readonly appendCaptureFailureActivity: ReturnType<typeof createAppendCaptureFailureActivity>
  readonly captureCheckpointFromTurnCompletion: ReturnType<
    typeof createCaptureCheckpointFromTurnCompletion
  >
  readonly ensurePreTurnBaselineFromTurnStart: ReturnType<
    typeof createCheckpointBaselineHandlers
  >['ensurePreTurnBaselineFromTurnStart']
}) {
  return Effect.fnUntraced(function* (event: ProviderRuntimeEvent) {
    if (event.type === 'turn.started') {
      yield* input.ensurePreTurnBaselineFromTurnStart(event)
      return
    }

    if (event.type === 'turn.completed') {
      const turnId = toTurnId(event.turnId)
      yield* input.captureCheckpointFromTurnCompletion(event).pipe(
        Effect.catch(error =>
          input
            .appendCaptureFailureActivity({
              threadId: event.threadId,
              turnId,
              detail: error.message,
              createdAt: new Date().toISOString(),
            })
            .pipe(Effect.catch(() => Effect.void))
        )
      )
    }
  })
}
function createProcessDomainEvent(input: {
  readonly appendCaptureFailureActivity: ReturnType<typeof createAppendCaptureFailureActivity>
  readonly captureCheckpointFromPlaceholder: ReturnType<
    typeof createCaptureCheckpointFromPlaceholder
  >
  readonly ensurePreTurnBaselineFromDomainTurnStart: ReturnType<
    typeof createCheckpointBaselineHandlers
  >['ensurePreTurnBaselineFromDomainTurnStart']
}) {
  return Effect.fnUntraced(function* (event: OrchestrationEvent) {
    if (event.type === 'thread.turn-start-requested' || event.type === 'thread.message-sent') {
      yield* input.ensurePreTurnBaselineFromDomainTurnStart(event)
      return
    }

    if (event.type === 'thread.turn-diff-completed') {
      yield* input.captureCheckpointFromPlaceholder(event).pipe(
        Effect.catch(error =>
          input
            .appendCaptureFailureActivity({
              threadId: event.payload.threadId,
              turnId: event.payload.turnId,
              detail: error.message,
              createdAt: new Date().toISOString(),
            })
            .pipe(Effect.catch(() => Effect.void))
        )
      )
    }
  })
}
export function createCheckpointCaptureHandlers(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly checkpointStore: CheckpointStoreShape
  readonly receiptBus: RuntimeReceiptBusShape
  readonly workspaceEntries: WorkspaceEntriesShape
  readonly appendCaptureFailureActivity: ReturnType<typeof createAppendCaptureFailureActivity>
  readonly resolveSessionRuntimeForThread: CheckpointSessionRuntimeResolver
}) {
  const captureAndDispatchCheckpoint = createCaptureAndDispatchCheckpoint(input)
  const baselineHandlers = createCheckpointBaselineHandlers({
    orchestrationEngine: input.orchestrationEngine,
    checkpointStore: input.checkpointStore,
    receiptBus: input.receiptBus,
    resolveSessionRuntimeForThread: input.resolveSessionRuntimeForThread,
  })

  return {
    processRuntimeEvent: createProcessRuntimeEvent({
      appendCaptureFailureActivity: input.appendCaptureFailureActivity,
      captureCheckpointFromTurnCompletion: createCaptureCheckpointFromTurnCompletion({
        orchestrationEngine: input.orchestrationEngine,
        resolveSessionRuntimeForThread: input.resolveSessionRuntimeForThread,
        captureAndDispatchCheckpoint,
      }),
      ensurePreTurnBaselineFromTurnStart: baselineHandlers.ensurePreTurnBaselineFromTurnStart,
    }),
    processDomainEvent: createProcessDomainEvent({
      appendCaptureFailureActivity: input.appendCaptureFailureActivity,
      captureCheckpointFromPlaceholder: createCaptureCheckpointFromPlaceholder({
        orchestrationEngine: input.orchestrationEngine,
        resolveSessionRuntimeForThread: input.resolveSessionRuntimeForThread,
        captureAndDispatchCheckpoint,
      }),
      ensurePreTurnBaselineFromDomainTurnStart:
        baselineHandlers.ensurePreTurnBaselineFromDomainTurnStart,
    }),
  }
}
