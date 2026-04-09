import type { OrchestrationReadModel, ThreadId, TurnId } from '@orxa-code/contracts'
import { Effect } from 'effect'
import type { OrchestrationDispatchError } from '../Errors.ts'

type OrchestrationThread = OrchestrationReadModel['threads'][number]

export type ProviderControlRoute = {
  readonly thread: OrchestrationThread
  readonly sessionThreadId: ThreadId
  readonly providerThreadId: string | null
  readonly activeTurnId: TurnId | null
  readonly isSubagentThread: boolean
  readonly parentThread: OrchestrationThread | null
}

export function listInterruptibleSubagentRoutes(
  input: {
    readonly threads: ReadonlyArray<OrchestrationThread>
    readonly parentThreadId: ThreadId
  },
  sessionThreadId: ThreadId
): ReadonlyArray<ProviderControlRoute> {
  return input.threads
    .filter(
      thread =>
        thread.parentLink?.relationKind === 'subagent' &&
        thread.parentLink.parentThreadId === input.parentThreadId &&
        thread.session?.status === 'running' &&
        thread.session.activeTurnId !== null &&
        thread.session.providerThreadId !== null &&
        thread.session.providerThreadId !== undefined
    )
    .map(thread => ({
      thread,
      sessionThreadId,
      providerThreadId: thread.session?.providerThreadId ?? null,
      activeTurnId: thread.session?.activeTurnId ?? null,
      isSubagentThread: true,
      parentThread: null,
    }))
}

type OrchestrationThreadSession = OrchestrationThread['session']

function shouldSkipSubagentSessionPropagation(
  status: 'interrupted' | 'stopped',
  session: OrchestrationThreadSession
) {
  return (
    session?.status === 'stopped' ||
    session?.status === 'error' ||
    (status === 'interrupted' && session?.status === 'ready')
  )
}

export function propagateSubagentSessionState(input: {
  readonly threads: ReadonlyArray<OrchestrationThread>
  readonly parentThreadId: ThreadId
  readonly status: 'interrupted' | 'stopped'
  readonly createdAt: string
  readonly setThreadSession: (args: {
    readonly threadId: ThreadId
    readonly session: ReturnType<typeof buildSessionStateSnapshot>
    readonly createdAt: string
  }) => Effect.Effect<unknown, OrchestrationDispatchError>
}) {
  return Effect.forEach(
    listSubagentChildren(input.threads, input.parentThreadId),
    childThread => {
      if (shouldSkipSubagentSessionPropagation(input.status, childThread.session)) {
        return Effect.void
      }
      return input
        .setThreadSession({
          threadId: childThread.id,
          session: buildSessionStateSnapshot({
            thread: childThread,
            status: input.status,
            createdAt: input.createdAt,
          }),
          createdAt: input.createdAt,
        })
        .pipe(Effect.asVoid)
    },
    { concurrency: 1 }
  ).pipe(Effect.asVoid)
}

export function buildSessionStateSnapshot(input: {
  readonly thread: OrchestrationThread
  readonly status: 'interrupted' | 'stopped'
  readonly createdAt: string
}) {
  const existingSession = input.thread.session
  return {
    threadId: input.thread.id,
    status: input.status,
    providerName: existingSession?.providerName ?? input.thread.parentLink?.provider ?? null,
    providerSessionId: existingSession?.providerSessionId ?? null,
    providerThreadId:
      existingSession?.providerThreadId ?? input.thread.parentLink?.providerChildThreadId ?? null,
    runtimeMode: existingSession?.runtimeMode ?? input.thread.runtimeMode,
    activeTurnId: null,
    lastError: existingSession?.lastError ?? null,
    updatedAt: input.createdAt,
  }
}

export function resolveProviderControlRoute(
  deps: {
    readonly resolveThread: (threadId: ThreadId) => Effect.Effect<OrchestrationThread | undefined>
  },
  threadId: ThreadId
) {
  return Effect.gen(function* () {
    const thread = yield* deps.resolveThread(threadId)
    if (!thread) {
      return null
    }

    const parentThreadId =
      thread.parentLink?.relationKind === 'subagent' ? thread.parentLink.parentThreadId : null
    if (!parentThreadId) {
      return {
        thread,
        sessionThreadId: thread.id,
        providerThreadId: thread.session?.providerThreadId ?? null,
        activeTurnId: thread.session?.activeTurnId ?? null,
        isSubagentThread: false,
        parentThread: null,
      } satisfies ProviderControlRoute
    }

    const parentThread = yield* deps.resolveThread(parentThreadId)
    return {
      thread,
      sessionThreadId: parentThread?.id ?? thread.id,
      providerThreadId:
        thread.session?.providerThreadId ?? thread.parentLink?.providerChildThreadId ?? null,
      activeTurnId: thread.session?.activeTurnId ?? null,
      isSubagentThread: parentThread !== undefined,
      parentThread: parentThread ?? null,
    } satisfies ProviderControlRoute
  })
}

export function listSubagentChildren(
  threads: ReadonlyArray<OrchestrationThread>,
  parentThreadId: ThreadId
) {
  return threads.filter(
    thread =>
      thread.parentLink?.relationKind === 'subagent' &&
      thread.parentLink.parentThreadId === parentThreadId
  )
}
