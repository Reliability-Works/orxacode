import { Effect } from 'effect'
import type { OrchestrationReadModel, ProviderRuntimeEvent } from '@orxa-code/contracts'

import {
  readClaudeChildProviderThreadIdForEvent,
  readClaudeChildThreadDescriptor,
} from '../../claudeChildThreads.ts'
import {
  createClaudeSubagentThread,
  syncClaudeSubagentThread,
} from './ProviderRuntimeIngestion.claudeSubagents.ts'
import type {
  ProcessRuntimeEventDeps,
  ReadModelThread,
} from './ProviderRuntimeIngestion.processEvent.handlers.ts'

function existingClaudeChildThreadForProviderChildId(
  readModel: OrchestrationReadModel,
  providerChildThreadId: string | null
): ReadModelThread | undefined {
  if (!providerChildThreadId) {
    return undefined
  }
  return readModel.threads.find(
    entry =>
      entry.parentLink?.relationKind === 'subagent' &&
      entry.parentLink.provider === 'claudeAgent' &&
      entry.parentLink.providerChildThreadId === providerChildThreadId
  )
}

export function resolveClaudeTargetThread(
  readModel: OrchestrationReadModel,
  event: ProviderRuntimeEvent
): ReadModelThread | undefined {
  const providerChildThreadId = readClaudeChildProviderThreadIdForEvent(event)
  return existingClaudeChildThreadForProviderChildId(readModel, providerChildThreadId)
}

export const ensureClaudeChildThreadsForEvent = (
  deps: ProcessRuntimeEventDeps,
  resolveThreadProjectRoot: (
    readModel: OrchestrationReadModel,
    thread: ReadModelThread
  ) => string | null
) => {
  const createSubagentThread = createClaudeSubagentThread(deps)
  const syncSubagentThread = syncClaudeSubagentThread(deps)
  return Effect.fn('ensureClaudeChildThreadsForEvent')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    readModel: OrchestrationReadModel
  ) {
    if (event.provider !== 'claudeAgent') {
      return
    }

    const descriptor = readClaudeChildThreadDescriptor(thread.id, event)
    if (!descriptor) {
      return
    }

    const existingThread = existingClaudeChildThreadForProviderChildId(
      readModel,
      descriptor.providerChildThreadId
    )
    const projectRoot = resolveThreadProjectRoot(readModel, thread)
    if (existingThread) {
      yield* syncSubagentThread(event, existingThread, thread, descriptor, projectRoot)
      return
    }

    yield* createSubagentThread(event, thread, descriptor, projectRoot)
  })
}
