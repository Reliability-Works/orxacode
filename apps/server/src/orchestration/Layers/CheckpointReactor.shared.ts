import {
  CommandId,
  EventId,
  type OrchestrationReadModel,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { Effect, Option } from 'effect'

import { resolveThreadWorkspaceCwd } from '../../checkpointing/Utils.ts'
import type { ProviderServiceShape } from '../../provider/Services/ProviderService.ts'
import type { OrchestrationEngineShape } from '../Services/OrchestrationEngine.ts'
import { isGitRepository } from '../../git/Utils.ts'
import { sameId } from './ReactorIdUtils.ts'

export { sameId }

type ReadModelThread = OrchestrationReadModel['threads'][number]
type ReadModelProject = OrchestrationReadModel['projects'][number]

export function toTurnId(value: string | undefined): TurnId | null {
  return value === undefined ? null : TurnId.makeUnsafe(String(value))
}

export function checkpointStatusFromRuntime(
  status: string | undefined
): 'ready' | 'missing' | 'error' {
  switch (status) {
    case 'failed':
      return 'error'
    case 'cancelled':
    case 'interrupted':
      return 'missing'
    case 'completed':
    default:
      return 'ready'
  }
}

export const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`)

function createAppendActivity(
  orchestrationEngine: OrchestrationEngineShape,
  input: {
    readonly commandTag: string
    readonly threadId: ThreadId
    readonly kind: 'checkpoint.revert.failed' | 'checkpoint.capture.failed'
    readonly summary: string
    readonly payload: Record<string, unknown>
    readonly turnId: TurnId | null
    readonly createdAt: string
  }
) {
  return orchestrationEngine.dispatch({
    type: 'thread.activity.append',
    commandId: serverCommandId(input.commandTag),
    threadId: input.threadId,
    activity: {
      id: EventId.makeUnsafe(crypto.randomUUID()),
      tone: 'error',
      kind: input.kind,
      summary: input.summary,
      payload: input.payload,
      turnId: input.turnId,
      createdAt: input.createdAt,
    },
    createdAt: input.createdAt,
  })
}

export function createAppendRevertFailureActivity(orchestrationEngine: OrchestrationEngineShape) {
  return (input: {
    readonly threadId: ThreadId
    readonly turnCount: number
    readonly detail: string
    readonly createdAt: string
  }) =>
    createAppendActivity(orchestrationEngine, {
      commandTag: 'checkpoint-revert-failure',
      threadId: input.threadId,
      kind: 'checkpoint.revert.failed',
      summary: 'Checkpoint revert failed',
      payload: {
        turnCount: input.turnCount,
        detail: input.detail,
      },
      turnId: null,
      createdAt: input.createdAt,
    })
}

export function createAppendCaptureFailureActivity(orchestrationEngine: OrchestrationEngineShape) {
  return (input: {
    readonly threadId: ThreadId
    readonly turnId: TurnId | null
    readonly detail: string
    readonly createdAt: string
  }) =>
    createAppendActivity(orchestrationEngine, {
      commandTag: 'checkpoint-capture-failure',
      threadId: input.threadId,
      kind: 'checkpoint.capture.failed',
      summary: 'Checkpoint capture failed',
      payload: {
        detail: input.detail,
      },
      turnId: input.turnId,
      createdAt: input.createdAt,
    })
}

function resolveSessionRuntimeWithCwd(
  threadId: ThreadId,
  sessions: ReadonlyArray<{
    readonly threadId: ThreadId
    readonly cwd?: string | undefined
  }>
) {
  const session = sessions.find(entry => entry.threadId === threadId)
  return session?.cwd
    ? Option.some({ threadId: session.threadId, cwd: session.cwd })
    : Option.none()
}

export function createResolveSessionRuntimeForThread(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly providerService: ProviderServiceShape
}) {
  return Effect.fnUntraced(function* (threadId: ThreadId) {
    const readModel = yield* input.orchestrationEngine.getReadModel()
    const thread = readModel.threads.find(entry => entry.id === threadId)
    const sessions = yield* input.providerService.listSessions()

    if (thread) {
      const fromProjected = resolveSessionRuntimeWithCwd(thread.id, sessions)
      if (Option.isSome(fromProjected)) {
        return fromProjected
      }
    }

    return Option.none()
  })
}

export function resolveCheckpointWorkspaceCwd(input: {
  readonly threadId: ThreadId
  readonly thread: Pick<ReadModelThread, 'projectId' | 'worktreePath'>
  readonly projects: ReadonlyArray<Pick<ReadModelProject, 'id' | 'workspaceRoot'>>
  readonly sessionRuntime: Option.Option<{ readonly threadId: ThreadId; readonly cwd: string }>
  readonly preferSessionRuntime: boolean
}): string | undefined {
  const fromThread = resolveThreadWorkspaceCwd({
    thread: input.thread,
    projects: input.projects,
  })
  const fromSession = Option.match(input.sessionRuntime, {
    onNone: () => undefined,
    onSome: runtime => runtime.cwd,
  })
  const cwd = input.preferSessionRuntime ? (fromSession ?? fromThread) : (fromThread ?? fromSession)
  if (!cwd || !isGitRepository(cwd)) {
    return undefined
  }
  return cwd
}

export function currentCheckpointTurnCount(thread: {
  readonly checkpoints: ReadonlyArray<{ readonly checkpointTurnCount: number }>
}): number {
  return thread.checkpoints.reduce(
    (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
    0
  )
}

export type CheckpointReactorReadThread = ReadModelThread
export type CheckpointReactorReadProject = ReadModelProject
export type CheckpointSessionRuntimeResolver = ReturnType<
  typeof createResolveSessionRuntimeForThread
>

export function resolveTurnContext(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly threadId: ThreadId
  readonly turnIdRaw: string | undefined
}) {
  return Effect.gen(function* () {
    const turnId = toTurnId(input.turnIdRaw)
    if (!turnId) {
      return null
    }
    const readModel = yield* input.orchestrationEngine.getReadModel()
    const thread = readModel.threads.find(entry => entry.id === input.threadId)
    if (!thread) {
      return null
    }
    return { turnId, thread, readModel } as const
  })
}
