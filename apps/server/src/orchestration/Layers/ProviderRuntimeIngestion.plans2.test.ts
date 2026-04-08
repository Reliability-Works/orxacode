import { afterEach, expect, it } from 'vitest'

import { Effect } from 'effect'

import {
  asEventId,
  asThreadId,
  asTurnId,
  createHarness,
  createRuntimeRefs,
  disposeRuntimeRefs,
  type IngestionHarness,
  waitForThread,
} from './ProviderRuntimeIngestion.test.helpers.ts'
import {
  createPlanSourceThread,
  createPlanTargetThread,
  dispatchImplementPlanTurnStart,
  emitPlanSourceCompleted,
  setProviderSessionForTarget,
  waitForSourcePlan,
} from './ProviderRuntimeIngestion.test.plans-helpers.ts'

const refs = createRuntimeRefs()
afterEach(async () => {
  await disposeRuntimeRefs(refs)
})

async function assertUnrelatedTurnDoesNotImplementPlan(
  harness: IngestionHarness,
  args: {
    readonly sourceThreadId: ReturnType<typeof asThreadId>
    readonly targetThreadId: ReturnType<typeof asThreadId>
    readonly replayedTurnId: ReturnType<typeof asTurnId>
    readonly sourcePlanId: string
  }
) {
  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-turn-started-unrelated-plan-implementation'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: args.targetThreadId,
    turnId: args.replayedTurnId,
  })
  await harness.drain()

  const readModel = await Effect.runPromise(harness.engine.getReadModel())
  const sourceThreadAfterUnrelatedStart = readModel.threads.find(
    entry => entry.id === args.sourceThreadId
  )
  expect(
    sourceThreadAfterUnrelatedStart?.proposedPlans.find(entry => entry.id === args.sourcePlanId)
  ).toMatchObject({ implementedAt: null, implementationThreadId: null })
}

it('does not mark the source proposed plan implemented for an unrelated turn.started when no thread active turn is tracked', async () => {
  const harness = await createHarness(refs)
  const sourceThreadId = asThreadId('thread-plan')
  const targetThreadId = asThreadId('thread-implement')
  const sourceTurnId = asTurnId('turn-plan-source')
  const expectedTurnId = asTurnId('turn-plan-implement')
  const replayedTurnId = asTurnId('turn-replayed')
  const createdAt = new Date().toISOString()

  await createPlanSourceThread(harness, sourceThreadId, 'unrelated', createdAt)
  await createPlanTargetThread(harness, targetThreadId, 'unrelated', createdAt)
  emitPlanSourceCompleted(harness, sourceThreadId, sourceTurnId, 'unrelated', createdAt)
  const sourcePlan = await waitForSourcePlan(harness, sourceThreadId)
  await dispatchImplementPlanTurnStart(harness, {
    sourceThreadId,
    targetThreadId,
    suffix: 'unrelated',
    sourcePlanId: sourcePlan.id,
  })
  setProviderSessionForTarget(harness, {
    targetThreadId,
    status: 'running',
    activeTurnId: expectedTurnId,
    createdAt,
  })
  await assertUnrelatedTurnDoesNotImplementPlan(harness, {
    sourceThreadId,
    targetThreadId,
    replayedTurnId,
    sourcePlanId: sourcePlan.id,
  })
})

it('finalizes buffered proposed-plan deltas into a first-class proposed plan on turn completion', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-turn-started-plan-buffer'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-plan-buffer'),
  })

  await waitForThread(
    harness.engine,
    thread =>
      thread.session?.status === 'running' && thread.session?.activeTurnId === 'turn-plan-buffer'
  )

  harness.emit({
    type: 'turn.proposed.delta',
    eventId: asEventId('evt-plan-delta-1'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-plan-buffer'),
    payload: { delta: '## Buffered plan\n\n- first' },
  })
  harness.emit({
    type: 'turn.proposed.delta',
    eventId: asEventId('evt-plan-delta-2'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-plan-buffer'),
    payload: { delta: '\n- second' },
  })
  harness.emit({
    type: 'turn.completed',
    eventId: asEventId('evt-turn-completed-plan-buffer'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-plan-buffer'),
    payload: { state: 'completed' },
  })

  const thread = await waitForThread(harness.engine, entry =>
    entry.proposedPlans.some(
      proposedPlan => proposedPlan.id === 'plan:thread-1:turn:turn-plan-buffer'
    )
  )
  const proposedPlan = thread.proposedPlans.find(
    entry => entry.id === 'plan:thread-1:turn:turn-plan-buffer'
  )
  expect(proposedPlan?.planMarkdown).toBe('## Buffered plan\n\n- first\n- second')
})
