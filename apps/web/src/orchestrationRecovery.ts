export type OrchestrationRecoveryReason = 'bootstrap' | 'sequence-gap' | 'replay-failed'

export interface OrchestrationRecoveryPhase {
  kind: 'snapshot' | 'replay'
  reason: OrchestrationRecoveryReason
}

export interface OrchestrationRecoveryState {
  latestSequence: number
  highestObservedSequence: number
  bootstrapped: boolean
  pendingReplay: boolean
  inFlight: OrchestrationRecoveryPhase | null
}

type SequencedEvent = Readonly<{ sequence: number }>

function classifyDomainEvent(params: {
  state: OrchestrationRecoveryState
  observeSequence: (sequence: number) => void
  requestReplay: () => void
  sequence: number
}): 'ignore' | 'defer' | 'recover' | 'apply' {
  params.observeSequence(params.sequence)
  if (params.sequence <= params.state.latestSequence) {
    return 'ignore'
  }
  if (!params.state.bootstrapped || params.state.inFlight) {
    params.requestReplay()
    return 'defer'
  }
  if (params.sequence !== params.state.latestSequence + 1) {
    params.requestReplay()
    return 'recover'
  }
  return 'apply'
}

function markEventBatchApplied<T extends SequencedEvent>(
  state: OrchestrationRecoveryState,
  events: ReadonlyArray<T>
): ReadonlyArray<T> {
  const nextEvents = events
    .filter(event => event.sequence > state.latestSequence)
    .toSorted((left, right) => left.sequence - right.sequence)
  if (nextEvents.length === 0) {
    return []
  }

  state.latestSequence = nextEvents.at(-1)?.sequence ?? state.latestSequence
  state.highestObservedSequence = Math.max(state.highestObservedSequence, state.latestSequence)
  return nextEvents
}

function beginReplayRecovery(params: {
  state: OrchestrationRecoveryState
  requestReplay: () => void
  startRecovery: (phase: OrchestrationRecoveryPhase) => boolean
  setReplayStartSequence: (sequence: number | null) => void
  reason: OrchestrationRecoveryReason
}): boolean {
  if (!params.state.bootstrapped || params.state.inFlight?.kind === 'snapshot') {
    params.requestReplay()
    return false
  }
  if (params.state.inFlight?.kind === 'replay') {
    params.requestReplay()
    return false
  }
  params.state.pendingReplay = false
  params.setReplayStartSequence(params.state.latestSequence)
  return params.startRecovery({ kind: 'replay', reason: params.reason })
}

function beginSnapshotRecovery(params: {
  canStartRecovery: (kind: OrchestrationRecoveryPhase['kind']) => boolean
  startRecovery: (phase: OrchestrationRecoveryPhase) => boolean
  reason: OrchestrationRecoveryReason
}): boolean {
  if (!params.canStartRecovery('snapshot')) {
    return false
  }
  return params.startRecovery({ kind: 'snapshot', reason: params.reason })
}

function completeSnapshotRecovery(params: {
  state: OrchestrationRecoveryState
  clearRecovery: () => void
  shouldReplayAfterRecovery: () => boolean
  snapshotSequence: number
}): boolean {
  params.state.latestSequence = Math.max(params.state.latestSequence, params.snapshotSequence)
  params.state.highestObservedSequence = Math.max(
    params.state.highestObservedSequence,
    params.state.latestSequence
  )
  params.state.bootstrapped = true
  params.clearRecovery()
  return params.shouldReplayAfterRecovery()
}

function completeReplayRecovery(params: {
  state: OrchestrationRecoveryState
  replayStartSequence: number | null
  setReplayStartSequence: (sequence: number | null) => void
  clearRecovery: () => void
  shouldReplayAfterRecovery: () => boolean
}): boolean {
  const replayMadeProgress =
    params.replayStartSequence !== null && params.state.latestSequence > params.replayStartSequence
  params.setReplayStartSequence(null)
  params.clearRecovery()
  if (!replayMadeProgress) {
    params.state.pendingReplay = false
    return false
  }
  return params.shouldReplayAfterRecovery()
}

function buildRecoveryCoordinator(params: {
  state: OrchestrationRecoveryState
  snapshotState: () => OrchestrationRecoveryState
  observeSequence: (sequence: number) => void
  requestReplay: () => void
  clearRecovery: () => void
  canStartRecovery: (kind: OrchestrationRecoveryPhase['kind']) => boolean
  startRecovery: (phase: OrchestrationRecoveryPhase) => boolean
  shouldReplayAfterRecovery: () => boolean
  replayStartSequence: () => number | null
  setReplayStartSequence: (sequence: number | null) => void
}) {
  return {
    getState(): OrchestrationRecoveryState {
      return params.snapshotState()
    },
    classifyDomainEvent(sequence: number): 'ignore' | 'defer' | 'recover' | 'apply' {
      return classifyDomainEvent({
        state: params.state,
        observeSequence: params.observeSequence,
        requestReplay: params.requestReplay,
        sequence,
      })
    },
    markEventBatchApplied<T extends SequencedEvent>(events: ReadonlyArray<T>): ReadonlyArray<T> {
      return markEventBatchApplied(params.state, events)
    },
    beginSnapshotRecovery(reason: OrchestrationRecoveryReason): boolean {
      return beginSnapshotRecovery({
        canStartRecovery: params.canStartRecovery,
        startRecovery: params.startRecovery,
        reason,
      })
    },
    completeSnapshotRecovery(snapshotSequence: number): boolean {
      return completeSnapshotRecovery({
        state: params.state,
        clearRecovery: params.clearRecovery,
        shouldReplayAfterRecovery: params.shouldReplayAfterRecovery,
        snapshotSequence,
      })
    },
    failSnapshotRecovery(): void {
      params.clearRecovery()
    },
    beginReplayRecovery(reason: OrchestrationRecoveryReason): boolean {
      return beginReplayRecovery({
        state: params.state,
        requestReplay: params.requestReplay,
        startRecovery: params.startRecovery,
        setReplayStartSequence: params.setReplayStartSequence,
        reason,
      })
    },
    completeReplayRecovery(): boolean {
      return completeReplayRecovery({
        state: params.state,
        replayStartSequence: params.replayStartSequence(),
        setReplayStartSequence: params.setReplayStartSequence,
        clearRecovery: params.clearRecovery,
        shouldReplayAfterRecovery: params.shouldReplayAfterRecovery,
      })
    },
    failReplayRecovery(): void {
      params.setReplayStartSequence(null)
      params.state.bootstrapped = false
      params.clearRecovery()
    },
  }
}

export function createOrchestrationRecoveryCoordinator() {
  const state: OrchestrationRecoveryState = {
    latestSequence: 0,
    highestObservedSequence: 0,
    bootstrapped: false,
    pendingReplay: false,
    inFlight: null,
  }
  let replayStartSequence: number | null = null
  const setReplayStartSequence = (sequence: number | null) => {
    replayStartSequence = sequence
  }

  const snapshotState = (): OrchestrationRecoveryState => ({
    ...state,
    ...(state.inFlight ? { inFlight: { ...state.inFlight } } : {}),
  })

  const observeSequence = (sequence: number) => {
    state.highestObservedSequence = Math.max(state.highestObservedSequence, sequence)
  }

  const requestReplay = () => {
    state.pendingReplay = true
  }

  const clearRecovery = () => {
    state.inFlight = null
  }

  const canStartRecovery = (kind: OrchestrationRecoveryPhase['kind']) => {
    if (state.inFlight?.kind === 'snapshot' || state.inFlight?.kind === 'replay') {
      requestReplay()
      return false
    }
    state.inFlight = { kind, reason: 'bootstrap' }
    return true
  }

  const startRecovery = (phase: OrchestrationRecoveryPhase) => {
    state.inFlight = phase
    return true
  }

  const shouldReplayAfterRecovery = (): boolean => {
    const shouldReplay = state.pendingReplay || state.highestObservedSequence > state.latestSequence
    state.pendingReplay = false
    return shouldReplay
  }

  return buildRecoveryCoordinator({
    state,
    snapshotState,
    observeSequence,
    requestReplay,
    clearRecovery,
    canStartRecovery,
    startRecovery,
    shouldReplayAfterRecovery,
    replayStartSequence: () => replayStartSequence,
    setReplayStartSequence,
  })
}
