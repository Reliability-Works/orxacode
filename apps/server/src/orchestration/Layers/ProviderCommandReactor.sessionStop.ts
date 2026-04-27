import type { OrchestrationReadModel, ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'

import type { ProviderCommandReactorEventHandlerDeps } from './ProviderCommandReactor.eventHandlers.ts'
import {
  buildSessionStateSnapshot,
  propagateSubagentSessionState,
  resolveProviderControlRoute,
} from './ProviderCommandReactor.subagentRouting.ts'

export function setRootThreadSessionAndPropagate(
  deps: ProviderCommandReactorEventHandlerDeps,
  input: {
    readonly thread: OrchestrationReadModel['threads'][number]
    readonly status: 'interrupted' | 'stopped'
    readonly createdAt: string
  }
) {
  return deps
    .setThreadSession({
      threadId: input.thread.id,
      session: buildSessionStateSnapshot({
        thread: input.thread,
        status: input.status,
        createdAt: input.createdAt,
      }),
      createdAt: input.createdAt,
    })
    .pipe(
      Effect.flatMap(() => deps.orchestrationEngine.getReadModel()),
      Effect.flatMap(readModel =>
        propagateSubagentSessionState({
          threads: readModel.threads,
          parentThreadId: input.thread.id,
          status: input.status,
          createdAt: input.createdAt,
          setThreadSession: deps.setThreadSession,
        })
      )
    )
}

export function createProcessSessionStopForThread(deps: ProviderCommandReactorEventHandlerDeps) {
  return Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId
    readonly occurredAt: string
  }) {
    const controlRoute = yield* resolveProviderControlRoute(deps, input.threadId)
    if (!controlRoute) {
      return
    }
    const thread = controlRoute.thread
    if (thread.session && thread.session.status !== 'stopped') {
      yield* deps.providerService.stopSession({ threadId: controlRoute.sessionThreadId })
    }
    const rootThread = controlRoute.parentThread ?? thread
    yield* setRootThreadSessionAndPropagate(deps, {
      thread: rootThread,
      status: 'stopped',
      createdAt: input.occurredAt,
    })
  })
}
