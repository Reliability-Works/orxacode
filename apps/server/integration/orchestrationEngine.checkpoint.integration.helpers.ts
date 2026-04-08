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
import type { ModelSelection } from '@orxa-code/contracts'

type ReadmeEditTurnResponse = {
  readonly turnStartedEventId: string
  readonly turnStartedAt: string
  readonly toolStartedEventId: string
  readonly toolStartedAt: string
  readonly toolCompletedEventId: string
  readonly toolCompletedAt: string
  readonly messageEventId: string
  readonly messageAt: string
  readonly messageText: string
  readonly turnCompletedEventId: string
  readonly turnCompletedAt: string
  readonly readmeContent: string
  readonly provider?: IntegrationProvider
}

function createReadmeEditTurnEvents(input: ReadmeEditTurnResponse) {
  const provider = input.provider ?? 'codex'

  return [
    {
      type: 'turn.started' as const,
      ...runtimeBase(input.turnStartedEventId, input.turnStartedAt, provider),
      threadId: THREAD_ID,
      turnId: FIXTURE_TURN_ID,
    },
    {
      type: 'tool.started' as const,
      ...runtimeBase(input.toolStartedEventId, input.toolStartedAt, provider),
      threadId: THREAD_ID,
      turnId: FIXTURE_TURN_ID,
      toolKind: 'command' as const,
      title: 'Edit file',
      detail: 'README.md',
    },
    {
      type: 'tool.completed' as const,
      ...runtimeBase(input.toolCompletedEventId, input.toolCompletedAt, provider),
      threadId: THREAD_ID,
      turnId: FIXTURE_TURN_ID,
      toolKind: 'command' as const,
      title: 'Edit file',
      detail: 'README.md',
    },
    {
      type: 'message.delta' as const,
      ...runtimeBase(input.messageEventId, input.messageAt, provider),
      threadId: THREAD_ID,
      turnId: FIXTURE_TURN_ID,
      delta: input.messageText,
    },
    {
      type: 'turn.completed' as const,
      ...runtimeBase(input.turnCompletedEventId, input.turnCompletedAt, provider),
      threadId: THREAD_ID,
      turnId: FIXTURE_TURN_ID,
      status: 'completed' as const,
    },
  ]
}

function createReadmeMutation(readmeContent: string) {
  return ({ cwd }: { readonly cwd: string }) =>
    Effect.sync(() => {
      fs.writeFileSync(path.join(cwd, 'README.md'), readmeContent, 'utf8')
    })
}

function buildReadmeEditTurn(input: ReadmeEditTurnResponse) {
  return {
    events: createReadmeEditTurnEvents(input),
    mutateWorkspace: createReadmeMutation(input.readmeContent),
  }
}

export function queueReadmeEditTurnResponseForNextSession(
  harness: OrchestrationIntegrationHarness,
  input: ReadmeEditTurnResponse
) {
  return harness.adapterHarness!.queueTurnResponseForNextSession(buildReadmeEditTurn(input))
}

export function queueReadmeEditTurnResponse(
  harness: OrchestrationIntegrationHarness,
  input: ReadmeEditTurnResponse
) {
  return harness.adapterHarness!.queueTurnResponse(THREAD_ID, buildReadmeEditTurn(input))
}

export function runReadmeEditTurn(
  harness: OrchestrationIntegrationHarness,
  input: ReadmeEditTurnResponse & {
    readonly commandId: string
    readonly messageId: string
    readonly text: string
    readonly nextSession?: boolean
    readonly modelSelection?: ModelSelection
  }
) {
  return Effect.gen(function* () {
    if (input.nextSession === true) {
      yield* queueReadmeEditTurnResponseForNextSession(harness, input)
    } else {
      yield* queueReadmeEditTurnResponse(harness, input)
    }

    yield* startTurn({
      harness,
      commandId: input.commandId,
      messageId: input.messageId,
      text: input.text,
      ...(input.modelSelection !== undefined
        ? {
            modelSelection: input.modelSelection,
          }
        : {}),
    })
  })
}
