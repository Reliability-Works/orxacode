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

async function assertPlanImplementedAfterStart(
  harness: IngestionHarness,
  args: {
    readonly sourceThreadId: ReturnType<typeof asThreadId>
    readonly targetThreadId: ReturnType<typeof asThreadId>
    readonly targetTurnId: ReturnType<typeof asTurnId>
    readonly sourcePlanId: string
  }
) {
  const sourceThreadBeforeStart = await waitForThread(
    harness.engine,
    thread =>
      thread.proposedPlans.some(
        proposedPlan => proposedPlan.id === args.sourcePlanId && proposedPlan.implementedAt === null
      ),
    2_000,
    args.sourceThreadId
  )
  expect(
    sourceThreadBeforeStart.proposedPlans.find(entry => entry.id === args.sourcePlanId)
  ).toMatchObject({ implementedAt: null, implementationThreadId: null })

  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-plan-target-started'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: args.targetThreadId,
    turnId: args.targetTurnId,
  })

  const sourceThreadAfterStart = await waitForThread(
    harness.engine,
    thread =>
      thread.proposedPlans.some(
        proposedPlan =>
          proposedPlan.id === args.sourcePlanId &&
          proposedPlan.implementedAt !== null &&
          proposedPlan.implementationThreadId === args.targetThreadId
      ),
    2_000,
    args.sourceThreadId
  )
  expect(
    sourceThreadAfterStart.proposedPlans.find(entry => entry.id === args.sourcePlanId)
  ).toMatchObject({ implementationThreadId: 'thread-implement' })
}

it('marks the source proposed plan implemented only after the target turn starts', async () => {
  const harness = await createHarness(refs)
  const sourceThreadId = asThreadId('thread-plan')
  const targetThreadId = asThreadId('thread-implement')
  const sourceTurnId = asTurnId('turn-plan-source')
  const targetTurnId = asTurnId('turn-plan-implement')
  const createdAt = new Date().toISOString()

  await createPlanSourceThread(harness, sourceThreadId, 'happy', createdAt)
  await createPlanTargetThread(harness, targetThreadId, 'happy', createdAt)
  setProviderSessionForTarget(harness, {
    targetThreadId,
    status: 'ready',
    activeTurnId: targetTurnId,
    createdAt,
  })

  emitPlanSourceCompleted(harness, sourceThreadId, sourceTurnId, 'happy', createdAt)
  const sourcePlan = await waitForSourcePlan(harness, sourceThreadId)
  await dispatchImplementPlanTurnStart(harness, {
    sourceThreadId,
    targetThreadId,
    suffix: 'happy',
    sourcePlanId: sourcePlan.id,
  })
  await assertPlanImplementedAfterStart(harness, {
    sourceThreadId,
    targetThreadId,
    targetTurnId,
    sourcePlanId: sourcePlan.id,
  })
})

async function assertRejectedTurnDoesNotImplementPlan(
  harness: IngestionHarness,
  args: {
    readonly sourceThreadId: ReturnType<typeof asThreadId>
    readonly targetThreadId: ReturnType<typeof asThreadId>
    readonly staleTurnId: ReturnType<typeof asTurnId>
    readonly activeTurnId: ReturnType<typeof asTurnId>
    readonly sourcePlanId: string
  }
) {
  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-turn-started-stale-plan-implementation'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: args.targetThreadId,
    turnId: args.staleTurnId,
  })
  await harness.drain()

  const readModel = await Effect.runPromise(harness.engine.getReadModel())
  const sourceThreadAfterRejectedStart = readModel.threads.find(
    entry => entry.id === args.sourceThreadId
  )
  expect(
    sourceThreadAfterRejectedStart?.proposedPlans.find(entry => entry.id === args.sourcePlanId)
  ).toMatchObject({ implementedAt: null, implementationThreadId: null })

  const targetThreadAfterRejectedStart = readModel.threads.find(
    entry => entry.id === args.targetThreadId
  )
  expect(targetThreadAfterRejectedStart?.session?.status).toBe('running')
  expect(targetThreadAfterRejectedStart?.session?.activeTurnId).toBe(args.activeTurnId)
}

it('does not mark the source proposed plan implemented for a rejected turn.started event', async () => {
  const harness = await createHarness(refs)
  const sourceThreadId = asThreadId('thread-plan')
  const targetThreadId = asThreadId('thread-1')
  const sourceTurnId = asTurnId('turn-plan-source')
  const activeTurnId = asTurnId('turn-already-running')
  const staleTurnId = asTurnId('turn-stale-start')
  const createdAt = new Date().toISOString()

  await createPlanSourceThread(harness, sourceThreadId, 'guarded', createdAt)
  setProviderSessionForTarget(harness, {
    targetThreadId,
    status: 'running',
    activeTurnId,
    createdAt,
  })
  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-turn-started-already-running'),
    provider: 'codex',
    createdAt,
    threadId: targetThreadId,
    turnId: activeTurnId,
  })
  await waitForThread(
    harness.engine,
    thread => thread.session?.status === 'running' && thread.session?.activeTurnId === activeTurnId,
    2_000,
    targetThreadId
  )

  emitPlanSourceCompleted(harness, sourceThreadId, sourceTurnId, 'guarded', createdAt)
  const sourcePlan = await waitForSourcePlan(harness, sourceThreadId)
  await dispatchImplementPlanTurnStart(harness, {
    sourceThreadId,
    targetThreadId,
    suffix: 'guarded',
    sourcePlanId: sourcePlan.id,
  })

  await assertRejectedTurnDoesNotImplementPlan(harness, {
    sourceThreadId,
    targetThreadId,
    staleTurnId,
    activeTurnId,
    sourcePlanId: sourcePlan.id,
  })
})
