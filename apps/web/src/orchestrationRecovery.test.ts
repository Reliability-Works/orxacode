import { describe, expect, it } from 'vitest'

import { createOrchestrationRecoveryCoordinator } from './orchestrationRecovery'

function createBootstrappedCoordinator(latestSequence = 3) {
  const coordinator = createOrchestrationRecoveryCoordinator()
  coordinator.beginSnapshotRecovery('bootstrap')
  coordinator.completeSnapshotRecovery(latestSequence)
  return coordinator
}

describe('createOrchestrationRecoveryCoordinator bootstrap and replay flow', () => {
  it('defers live events until bootstrap completes and then requests replay', () => {
    const coordinator = createOrchestrationRecoveryCoordinator()

    expect(coordinator.beginSnapshotRecovery('bootstrap')).toBe(true)
    expect(coordinator.classifyDomainEvent(4)).toBe('defer')

    expect(coordinator.completeSnapshotRecovery(2)).toBe(true)
    expect(coordinator.getState()).toMatchObject({
      latestSequence: 2,
      highestObservedSequence: 4,
      bootstrapped: true,
      pendingReplay: false,
      inFlight: null,
    })
  })

  it('classifies sequence gaps as recovery-only replay work', () => {
    const coordinator = createBootstrappedCoordinator()

    expect(coordinator.classifyDomainEvent(5)).toBe('recover')
    expect(coordinator.beginReplayRecovery('sequence-gap')).toBe(true)
    expect(coordinator.getState().inFlight).toEqual({
      kind: 'replay',
      reason: 'sequence-gap',
    })
  })

  it('supports replay recovery triggered by domain stream resubscribe', () => {
    const coordinator = createBootstrappedCoordinator()

    expect(coordinator.beginReplayRecovery('resubscribe')).toBe(true)
    expect(coordinator.getState().inFlight).toEqual({
      kind: 'replay',
      reason: 'resubscribe',
    })
  })

  it('tracks live event batches without entering recovery', () => {
    const coordinator = createBootstrappedCoordinator()

    expect(coordinator.classifyDomainEvent(4)).toBe('apply')
    expect(coordinator.markEventBatchApplied([{ sequence: 4 }])).toEqual([{ sequence: 4 }])
    expect(coordinator.getState()).toMatchObject({
      latestSequence: 4,
      highestObservedSequence: 4,
      bootstrapped: true,
      inFlight: null,
    })
  })

  it('requests another replay when deferred events arrive during replay recovery', () => {
    const coordinator = createBootstrappedCoordinator()
    coordinator.classifyDomainEvent(5)
    coordinator.beginReplayRecovery('sequence-gap')
    coordinator.classifyDomainEvent(7)
    coordinator.markEventBatchApplied([{ sequence: 4 }, { sequence: 5 }, { sequence: 6 }])

    expect(coordinator.completeReplayRecovery()).toBe(true)
  })

  it('does not immediately replay again when replay returns no new events', () => {
    const coordinator = createBootstrappedCoordinator()
    coordinator.classifyDomainEvent(5)
    coordinator.beginReplayRecovery('sequence-gap')

    expect(coordinator.completeReplayRecovery()).toBe(false)
    expect(coordinator.getState()).toMatchObject({
      latestSequence: 3,
      highestObservedSequence: 5,
      pendingReplay: false,
      inFlight: null,
    })
  })
})

describe('createOrchestrationRecoveryCoordinator snapshot recovery modes', () => {
  it('marks replay failure as unbootstrapped so snapshot fallback is recovery-only', () => {
    const coordinator = createBootstrappedCoordinator()
    coordinator.beginReplayRecovery('sequence-gap')
    coordinator.failReplayRecovery()

    expect(coordinator.getState()).toMatchObject({
      bootstrapped: false,
      inFlight: null,
    })
    expect(coordinator.beginSnapshotRecovery('replay-failed')).toBe(true)
    expect(coordinator.getState().inFlight).toEqual({
      kind: 'snapshot',
      reason: 'replay-failed',
    })
  })

  it('supports explicit foreground snapshot reconciliation after bootstrap', () => {
    const coordinator = createBootstrappedCoordinator()

    expect(coordinator.beginSnapshotRecovery('foreground-reconcile')).toBe(true)
    expect(coordinator.getState().inFlight).toEqual({
      kind: 'snapshot',
      reason: 'foreground-reconcile',
    })
    expect(coordinator.completeSnapshotRecovery(6)).toBe(false)
    expect(coordinator.getState()).toMatchObject({
      latestSequence: 6,
      highestObservedSequence: 6,
      bootstrapped: true,
      inFlight: null,
    })
  })
})
