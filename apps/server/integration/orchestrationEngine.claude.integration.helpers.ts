import fs from 'node:fs'
import path from 'node:path'

import { Effect } from 'effect'

import type { OrchestrationIntegrationHarness } from './OrchestrationEngineHarness.integration.ts'
import {
  FIXTURE_TURN_ID,
  runtimeBase,
  startTurn,
  THREAD_ID,
  type IntegrationProvider,
} from './orchestrationEngine.integration.helpers.ts'

type ClaudeTurnResponse = {
  readonly startedEventId: string
  readonly startedAt: string
  readonly deltaEventId: string
  readonly deltaAt: string
  readonly delta: string
  readonly completedEventId: string
  readonly completedAt: string
  readonly mutateReadmeTo?: string
}

const CLAUDE_PROVIDER: IntegrationProvider = 'claudeAgent'
const CLAUDE_MODEL = 'claude-sonnet-4-6'

function createClaudeTurnEvents(input: ClaudeTurnResponse) {
  return [
    {
      type: 'turn.started' as const,
      ...runtimeBase(input.startedEventId, input.startedAt, CLAUDE_PROVIDER),
      threadId: THREAD_ID,
      turnId: FIXTURE_TURN_ID,
    },
    {
      type: 'message.delta' as const,
      ...runtimeBase(input.deltaEventId, input.deltaAt, CLAUDE_PROVIDER),
      threadId: THREAD_ID,
      turnId: FIXTURE_TURN_ID,
      delta: input.delta,
    },
    {
      type: 'turn.completed' as const,
      ...runtimeBase(input.completedEventId, input.completedAt, CLAUDE_PROVIDER),
      threadId: THREAD_ID,
      turnId: FIXTURE_TURN_ID,
      status: 'completed' as const,
    },
  ]
}

function createReadmeMutation(content: string) {
  return ({ cwd }: { readonly cwd: string }) =>
    Effect.sync(() => {
      fs.writeFileSync(path.join(cwd, 'README.md'), content, 'utf8')
    })
}

function buildQueuedClaudeTurn(input: ClaudeTurnResponse) {
  return {
    events: createClaudeTurnEvents(input),
    ...(input.mutateReadmeTo !== undefined
      ? {
          mutateWorkspace: createReadmeMutation(input.mutateReadmeTo),
        }
      : {}),
  }
}

export function queueClaudeTurnResponseForNextSession(
  harness: OrchestrationIntegrationHarness,
  input: ClaudeTurnResponse
) {
  return harness.adapterHarness!.queueTurnResponseForNextSession(buildQueuedClaudeTurn(input))
}

export function queueClaudeTurnResponse(
  harness: OrchestrationIntegrationHarness,
  input: ClaudeTurnResponse
) {
  return harness.adapterHarness!.queueTurnResponse(THREAD_ID, buildQueuedClaudeTurn(input))
}

export function startClaudeTurn(
  harness: OrchestrationIntegrationHarness,
  input: {
    readonly commandId: string
    readonly messageId: string
    readonly text: string
    readonly selectModel?: boolean
  }
) {
  return startTurn({
    harness,
    commandId: input.commandId,
    messageId: input.messageId,
    text: input.text,
    ...(input.selectModel === true
      ? {
          modelSelection: {
            provider: CLAUDE_PROVIDER,
            model: CLAUDE_MODEL,
          },
        }
      : {}),
  })
}
