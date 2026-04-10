import type {
  MessageId,
  ProviderRuntimeEvent,
  RuntimeMode,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'

import { providerCommandId } from './ProviderRuntimeIngestion.helpers.ts'
import type { ProcessRuntimeEventDeps } from './ProviderRuntimeIngestion.processEvent.handlers.ts'

export function dispatchRunningSubagentSession(input: {
  readonly deps: ProcessRuntimeEventDeps
  readonly event: ProviderRuntimeEvent
  readonly threadId: ThreadId
  readonly providerChildThreadId: string
  readonly providerSessionId: string | null
  readonly runtimeMode: RuntimeMode
  readonly activeTurnId: TurnId | null
}) {
  return input.deps.orchestrationEngine.dispatch({
    type: 'thread.session.set',
    commandId: providerCommandId(
      input.event,
      `subagent-thread-session-set:${input.providerChildThreadId}`
    ),
    threadId: input.threadId,
    session: {
      threadId: input.threadId,
      status: 'running',
      providerName: input.event.provider,
      providerSessionId: input.providerSessionId,
      providerThreadId: input.providerChildThreadId,
      runtimeMode: input.runtimeMode,
      activeTurnId: input.activeTurnId,
      lastError: null,
      updatedAt: input.event.createdAt,
    },
    createdAt: input.event.createdAt,
  })
}

export function dispatchSubagentSeedMessage(input: {
  readonly deps: ProcessRuntimeEventDeps
  readonly event: ProviderRuntimeEvent
  readonly threadId: ThreadId
  readonly providerChildThreadId: string
  readonly messageId: MessageId
  readonly text: string
}) {
  return input.deps.orchestrationEngine.dispatch({
    type: 'thread.message.seed',
    commandId: providerCommandId(
      input.event,
      `subagent-thread-seed:${input.providerChildThreadId}`
    ),
    threadId: input.threadId,
    messageId: input.messageId,
    role: 'user',
    text: input.text,
    turnId: null,
    createdAt: input.event.createdAt,
  })
}
