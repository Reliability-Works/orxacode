import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ProviderSession,
  ThreadId,
  type TurnId,
} from '@orxa-code/contracts'
import { Effect } from 'effect'
import { expect } from 'vitest'

import {
  asEventId,
  asMessageId,
  asProjectId,
  type IngestionHarness,
  waitForThread,
} from './ProviderRuntimeIngestion.test.helpers.ts'

export interface PlanThreadIds {
  readonly sourceThreadId: ThreadId
  readonly targetThreadId: ThreadId
  readonly sourceTurnId: TurnId
}

export async function createPlanSourceThread(
  harness: IngestionHarness,
  sourceThreadId: ThreadId,
  suffix: string,
  createdAt: string
) {
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.create',
      commandId: CommandId.makeUnsafe(`cmd-thread-create-plan-source-${suffix}`),
      threadId: sourceThreadId,
      projectId: asProjectId('project-1'),
      title: 'Plan Source',
      modelSelection: { provider: 'codex', model: 'gpt-5-codex' },
      interactionMode: 'plan',
      runtimeMode: 'approval-required',
      branch: null,
      worktreePath: null,
      gitRoot: null,
      createdAt,
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe(`cmd-session-set-plan-source-${suffix}`),
      threadId: sourceThreadId,
      session: {
        threadId: sourceThreadId,
        status: 'ready',
        providerName: 'codex',
        runtimeMode: 'approval-required',
        activeTurnId: null,
        updatedAt: createdAt,
        lastError: null,
      },
      createdAt,
    })
  )
}

export async function createPlanTargetThread(
  harness: IngestionHarness,
  targetThreadId: ThreadId,
  suffix: string,
  createdAt: string
) {
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.create',
      commandId: CommandId.makeUnsafe(`cmd-thread-create-plan-target-${suffix}`),
      threadId: targetThreadId,
      projectId: asProjectId('project-1'),
      title: 'Plan Target',
      modelSelection: { provider: 'codex', model: 'gpt-5-codex' },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      branch: null,
      worktreePath: null,
      gitRoot: null,
      createdAt,
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe(`cmd-session-set-plan-target-${suffix}`),
      threadId: targetThreadId,
      session: {
        threadId: targetThreadId,
        status: 'ready',
        providerName: 'codex',
        runtimeMode: 'approval-required',
        activeTurnId: null,
        updatedAt: createdAt,
        lastError: null,
      },
      createdAt,
    })
  )
}

export function emitPlanSourceCompleted(
  harness: IngestionHarness,
  sourceThreadId: ThreadId,
  sourceTurnId: TurnId,
  suffix: string,
  createdAt: string
) {
  harness.emit({
    type: 'turn.proposed.completed',
    eventId: asEventId(`evt-plan-source-completed-${suffix}`),
    provider: 'codex',
    createdAt,
    threadId: sourceThreadId,
    turnId: sourceTurnId,
    payload: { planMarkdown: '# Source plan' },
  })
}

export async function waitForSourcePlan(harness: IngestionHarness, sourceThreadId: ThreadId) {
  const sourceThreadWithPlan = await waitForThread(
    harness.engine,
    thread =>
      thread.proposedPlans.some(
        proposedPlan =>
          proposedPlan.id === 'plan:thread-plan:turn:turn-plan-source' &&
          proposedPlan.implementedAt === null
      ),
    2_000,
    sourceThreadId
  )
  const sourcePlan = sourceThreadWithPlan.proposedPlans.find(
    entry => entry.id === 'plan:thread-plan:turn:turn-plan-source'
  )
  expect(sourcePlan).toBeDefined()
  if (!sourcePlan) {
    throw new Error('Expected source plan to exist.')
  }
  return sourcePlan
}

export async function dispatchImplementPlanTurnStart(
  harness: IngestionHarness,
  args: {
    readonly sourceThreadId: ThreadId
    readonly targetThreadId: ThreadId
    readonly suffix: string
    readonly sourcePlanId: string
  }
) {
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe(`cmd-turn-start-plan-target-${args.suffix}`),
      threadId: args.targetThreadId,
      message: {
        messageId: asMessageId(`msg-plan-target-${args.suffix}`),
        role: 'user',
        text: 'PLEASE IMPLEMENT THIS PLAN:\n# Source plan',
        attachments: [],
      },
      sourceProposedPlan: {
        threadId: args.sourceThreadId,
        planId: args.sourcePlanId,
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: new Date().toISOString(),
    })
  )
}

export function setProviderSessionForTarget(
  harness: IngestionHarness,
  args: {
    readonly targetThreadId: ThreadId
    readonly status: ProviderSession['status']
    readonly activeTurnId: TurnId | null
    readonly createdAt: string
  }
) {
  harness.setProviderSession({
    provider: 'codex',
    status: args.status,
    runtimeMode: 'approval-required',
    threadId: args.targetThreadId,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
    ...(args.activeTurnId !== null ? { activeTurnId: args.activeTurnId } : {}),
  })
}
