import type { OrchestrationEvent } from '@orxa-code/contracts'
import type { QueryClient } from '@tanstack/react-query'
import { Throttler } from '@tanstack/react-pacer'
import { clearPromotedDraftThread, useComposerDraftStore } from '../composerDraftStore'
import { projectQueryKeys } from '../lib/projectReactQuery'
import { providerQueryKeys } from '../lib/providerReactQuery'
import { readNativeApi } from '../nativeApi'
import { deriveOrchestrationBatchEffects } from '../orchestrationEventEffects'
import { createOrchestrationRecoveryCoordinator } from '../orchestrationRecovery'
import { getWsRpcClient } from '../wsRpcClient'
import {
  REPLAY_RECOVERY_TIMEOUT_MS,
  retryTransportRecoveryOperation,
  SNAPSHOT_RECOVERY_TIMEOUT_MS,
} from './-eventRouterConnectionLifecycle'
import { logResolvedReconcile, logSyncReady } from './-eventRouterRecoveryTelemetry'
import {
  applyForegroundReconcileSnapshot,
  completeSnapshotRecovery,
} from './-eventRouterRecoverySnapshot'
import { resolveConnectionReconcileAction } from './-eventRouterRecoveryPolicy'
import { syncProjectsFromStore, syncThreadsFromStore } from './-eventRouterSnapshotState'
import type { RuntimeSyncOptions } from './-eventRouterRuntimeSync'
type NativeApi = NonNullable<ReturnType<typeof readNativeApi>>
type RecoveryCoordinator = ReturnType<typeof createOrchestrationRecoveryCoordinator>
type BatchEffects = ReturnType<typeof deriveOrchestrationBatchEffects>
type RecoveryReason = 'bootstrap' | 'replay-failed'
type ReplayRecoveryReason = 'sequence-gap' | 'resubscribe'

type SnapshotSyncParams = Pick<
  RuntimeSyncOptions,
  'activeEnvironmentId' | 'removeOrphanedTerminalStates' | 'syncProjects' | 'syncServerReadModel' | 'syncThreads'
>

type SnapshotRecoveryParams = SnapshotSyncParams & {
  connectionId: RuntimeSyncOptions['connectionId']
  api: NativeApi
  isDisposed: () => boolean
  recoverFromSequenceGap: (reason: ReplayRecoveryReason) => Promise<void>
  recovery: RecoveryCoordinator
}

type ForegroundReconcileParams = SnapshotRecoveryParams & {
  runtimeGeneration: RuntimeSyncOptions['runtimeGeneration']
}

type ReplayRecoveryParams = {
  api: NativeApi
  applyEventBatch: (events: ReadonlyArray<OrchestrationEvent>) => void
  isDisposed: () => boolean
  recovery: RecoveryCoordinator
  runSnapshotRecovery: (reason: RecoveryReason) => Promise<void>
}

type RuntimeRecoveryActionParams = ForegroundReconcileParams

function logRecoveryInfo(event: string, data: Record<string, unknown>) {
  console.info('[mobile-sync] ' + event, {
    revision: 'mobile-reopen-probe-1',
    ...data,
  })
}

function logRecoveryWarn(event: string, data: Record<string, unknown>) {
  console.warn('[mobile-sync] ' + event, {
    revision: 'mobile-reopen-probe-1',
    ...data,
  })
}

function logRecoveryError(event: string, data: Record<string, unknown>) {
  console.error('[mobile-sync] ' + event, {
    revision: 'mobile-reopen-probe-1',
    ...data,
  })
}
function resolveForegroundReconcilePayload(
  api: NativeApi,
  isDisposed: () => boolean,
  canRecoverSnapshot: boolean
) {
  return canRecoverSnapshot
    ? retryTransportRecoveryOperation(() => api.orchestration.getSnapshot(), isDisposed, {
        label: 'orchestration.getSnapshot',
        reconnect: () => getWsRpcClient().reconnect(),
        timeoutMs: SNAPSHOT_RECOVERY_TIMEOUT_MS,
      })
    : Promise.resolve(null)
}

function clearBatchDerivedState(
  clearThreadUi: RuntimeSyncOptions['clearThreadUi'],
  removeTerminalState: RuntimeSyncOptions['removeTerminalState'],
  batchEffects: BatchEffects
) {
  const draftStore = useComposerDraftStore.getState()
  for (const threadId of batchEffects.clearPromotedDraftThreadIds) {
    clearPromotedDraftThread(threadId)
  }
  for (const threadId of batchEffects.clearDeletedThreadIds) {
    draftStore.clearDraftThread(threadId)
    clearThreadUi(threadId)
  }
  for (const threadId of batchEffects.removeTerminalStateThreadIds) {
    removeTerminalState(threadId)
  }
}

function createQueryInvalidationThrottler(
  queryClient: QueryClient,
  providerInvalidationState: { current: boolean }
) {
  return new Throttler<() => void>(
    () => {
      if (!providerInvalidationState.current) {
        return
      }
      providerInvalidationState.current = false
      void queryClient.invalidateQueries({ queryKey: providerQueryKeys.all })
      void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all })
    },
    { wait: 100, leading: false, trailing: true }
  )
}

function createApplyEventBatch({
  applyOrchestrationEvents,
  clearThreadUi,
  providerInvalidationState,
  queryInvalidationThrottler,
  recovery,
  removeTerminalState,
  syncProjects,
  syncThreads,
}: {
  applyOrchestrationEvents: RuntimeSyncOptions['applyOrchestrationEvents']
  clearThreadUi: RuntimeSyncOptions['clearThreadUi']
  providerInvalidationState: { current: boolean }
  queryInvalidationThrottler: Throttler<() => void>
  recovery: RecoveryCoordinator
  removeTerminalState: RuntimeSyncOptions['removeTerminalState']
  syncProjects: RuntimeSyncOptions['syncProjects']
  syncThreads: RuntimeSyncOptions['syncThreads']
}) {
  return (events: ReadonlyArray<OrchestrationEvent>) => {
    const nextEvents = recovery.markEventBatchApplied(events)
    if (nextEvents.length === 0) {
      return
    }

    const batchEffects = deriveOrchestrationBatchEffects(nextEvents)
    if (batchEffects.needsProviderInvalidation) {
      providerInvalidationState.current = true
      void queryInvalidationThrottler.maybeExecute()
    }
    applyOrchestrationEvents(nextEvents)

    if (nextEvents.some(event => event.type.startsWith('project.'))) {
      syncProjectsFromStore(syncProjects)
    }
    if (
      nextEvents.some(event => event.type === 'thread.created' || event.type === 'thread.deleted')
    ) {
      syncThreadsFromStore(syncThreads)
    }
    clearBatchDerivedState(clearThreadUi, removeTerminalState, batchEffects)
  }
}

function createRunSnapshotRecovery({
  activeEnvironmentId,
  connectionId,
  api,
  isDisposed,
  recoverFromSequenceGap,
  recovery,
  removeOrphanedTerminalStates,
  syncProjects,
  syncServerReadModel,
  syncThreads,
}: SnapshotRecoveryParams) {
  return async (reason: RecoveryReason) => {
    const logData = {
      connectionId,
      environmentId: activeEnvironmentId,
      reason,
    }
    logRecoveryInfo('snapshot recovery start', logData)
    if (!recovery.beginSnapshotRecovery(reason)) {
      logRecoveryInfo('snapshot recovery skipped', logData)
      return
    }
    try {
      const snapshot = await retryTransportRecoveryOperation(
        () => api.orchestration.getSnapshot(),
        isDisposed,
        {
          label: 'orchestration.getSnapshot',
          reconnect: () => getWsRpcClient().reconnect(),
          timeoutMs: SNAPSHOT_RECOVERY_TIMEOUT_MS,
        }
      )
      logRecoveryInfo('snapshot recovery resolved', {
        ...logData,
        snapshotSequence: snapshot.snapshotSequence,
        projects: snapshot.projects.length,
        threads: snapshot.threads.length,
      })
      await completeSnapshotRecovery({
        activeEnvironmentId,
        completeSnapshotRecoveryState: snapshotSequence =>
          recovery.completeSnapshotRecovery(snapshotSequence),
        isDisposed,
        logData,
        logInfo: logRecoveryInfo,
        logWarn: logRecoveryWarn,
        removeOrphanedTerminalStates,
        recoverFromSequenceGap: () => recoverFromSequenceGap('sequence-gap'),
        snapshot,
        syncProjects,
        syncServerReadModel,
        syncThreads,
      })
    } catch (error) {
      logRecoveryError('snapshot recovery error', {
        ...logData,
        error,
      })
      recovery.failSnapshotRecovery()
    }
  }
}

function createRunForegroundReconcile({
  activeEnvironmentId,
  connectionId,
  runtimeGeneration,
  api,
  isDisposed,
  recoverFromSequenceGap,
  recovery,
  removeOrphanedTerminalStates,
  syncProjects,
  syncServerReadModel,
  syncThreads,
}: ForegroundReconcileParams) {
  return async () => {
    const canRecoverSnapshot = recovery.beginSnapshotRecovery('foreground-reconcile')
    const logData = {
      connectionId,
      environmentId: activeEnvironmentId,
      runtimeGeneration,
      canRecoverSnapshot,
      disposed: isDisposed(),
    }
    logRecoveryInfo('reconcile start', logData)
    try {
      const snapshot = await resolveForegroundReconcilePayload(
        api,
        isDisposed,
        canRecoverSnapshot
      )
      logResolvedReconcile(logRecoveryInfo, {
        logData,
        disposed: isDisposed(),
        hasConfig: false,
        snapshot,
      })
      if (isDisposed()) {
        if (canRecoverSnapshot) {
          recovery.failSnapshotRecovery()
        }
        logRecoveryWarn('reconcile aborted disposed', logData)
        return
      }

      if (!canRecoverSnapshot || snapshot === null) {
        logRecoveryInfo('reconcile config-only completion', logData)
        return
      }

      applyForegroundReconcileSnapshot({
        activeEnvironmentId,
        log: logRecoveryInfo,
        logData,
        removeOrphanedTerminalStates,
        snapshot,
        syncProjects,
        syncServerReadModel,
        syncThreads,
      })
      logSyncReady(logRecoveryInfo, {
        logData,
        snapshot,
        stage: 'foreground-reconcile',
      })
      if (recovery.completeSnapshotRecovery(snapshot.snapshotSequence)) {
        await recoverFromSequenceGap('sequence-gap')
      }
    } catch (error) {
      logRecoveryError('reconcile error', {
        ...logData,
        error,
      })
      if (canRecoverSnapshot) {
        recovery.failSnapshotRecovery()
      }
    }
  }
}

function createRecoverFromSequenceGap({
  api,
  applyEventBatch,
  isDisposed,
  recovery,
  runSnapshotRecovery,
}: ReplayRecoveryParams) {
  return async function recoverFromSequenceGap(
    reason: ReplayRecoveryReason
  ): Promise<void> {
    if (!recovery.beginReplayRecovery(reason)) {
      return
    }
    try {
      const fromSequenceExclusive = recovery.getState().latestSequence
      const events = await retryTransportRecoveryOperation(
        () => api.orchestration.replayEvents(fromSequenceExclusive),
        isDisposed,
        {
          label: 'orchestration.replayEvents',
          reconnect: () => getWsRpcClient().reconnect(),
          timeoutMs: REPLAY_RECOVERY_TIMEOUT_MS,
        }
      )
      if (!isDisposed()) {
        applyEventBatch(events)
      }
    } catch {
      recovery.failReplayRecovery()
      await runSnapshotRecovery('replay-failed')
      return
    }
    if (!isDisposed() && recovery.completeReplayRecovery()) {
      await recoverFromSequenceGap('sequence-gap')
    }
  }
}

function createRuntimeRecoveryActions(params: RuntimeRecoveryActionParams) {
  const runForegroundReconcile = createRunForegroundReconcile({
    api: params.api,
    activeEnvironmentId: params.activeEnvironmentId,
    connectionId: params.connectionId,
    isDisposed: params.isDisposed,
    recoverFromSequenceGap: params.recoverFromSequenceGap,
    recovery: params.recovery,
    removeOrphanedTerminalStates: params.removeOrphanedTerminalStates,
    runtimeGeneration: params.runtimeGeneration,
    syncProjects: params.syncProjects,
    syncServerReadModel: params.syncServerReadModel,
    syncThreads: params.syncThreads,
  })

  return {
    runConnectionReconcile: async () => {
      const state = params.recovery.getState()
      const reconcileLogData = {
        connectionId: params.connectionId,
        environmentId: params.activeEnvironmentId,
        runtimeGeneration: params.runtimeGeneration,
      }
      switch (resolveConnectionReconcileAction(state)) {
        case 'skip':
          logRecoveryInfo('connection reconcile skipped', {
            ...reconcileLogData,
            bootstrapped: state.bootstrapped,
            reason:
              state.inFlight !== null
                ? `${state.inFlight.kind}-in-flight`
                : state.bootstrapped
                  ? 'unknown'
                  : 'not-bootstrapped',
          })
          return
        case 'reconcile-only':
          logRecoveryInfo('connection reconcile without reconnect', {
            ...reconcileLogData,
            reason: state.bootstrapped ? 'bootstrapped' : 'not-bootstrapped',
          })
          await runForegroundReconcile()
          return
      }
    },
    runForegroundReconcile,
  }
}

function createSnapshotRecoveryContext({
  activeEnvironmentId,
  connectionId,
  runtimeGeneration,
  api,
  isDisposed,
  recoverFromSequenceGap,
  recovery,
  removeOrphanedTerminalStates,
  syncProjects,
  syncServerReadModel,
  syncThreads,
}: ForegroundReconcileParams) {
  return {
    activeEnvironmentId,
    connectionId,
    runtimeGeneration,
    api,
    isDisposed,
    recoverFromSequenceGap,
    recovery,
    removeOrphanedTerminalStates,
    syncProjects,
    syncServerReadModel,
    syncThreads,
  }
}

export function createRuntimeRecoveryPipeline({
  activeEnvironmentId,
  connectionId,
  runtimeGeneration,
  api,
  applyOrchestrationEvents,
  clearThreadUi,
  disposedRef,
  queryClient,
  removeOrphanedTerminalStates,
  removeTerminalState,
  syncProjects,
  syncServerReadModel,
  syncThreads,
}: Omit<RuntimeSyncOptions, 'bootstrapFromSnapshotRef'> & { api: NativeApi }) {
  let disposed = false
  disposedRef.current = false
  const recovery = createOrchestrationRecoveryCoordinator()
  const providerInvalidationState = { current: false }
  const queryInvalidationThrottler = createQueryInvalidationThrottler(
    queryClient,
    providerInvalidationState
  )
  const applyEventBatch = createApplyEventBatch({
    applyOrchestrationEvents,
    clearThreadUi,
    providerInvalidationState,
    queryInvalidationThrottler,
    recovery,
    removeTerminalState,
    syncProjects,
    syncThreads,
  })

  let runSnapshotRecovery: (reason: 'bootstrap' | 'replay-failed') => Promise<void> = async () =>
    undefined
  const recoverFromSequenceGap = createRecoverFromSequenceGap({
    api,
    applyEventBatch,
    isDisposed: () => disposed,
    recovery,
    runSnapshotRecovery: reason => runSnapshotRecovery(reason),
  })
  const snapshotRecoveryContext = createSnapshotRecoveryContext({
    activeEnvironmentId,
    connectionId,
    runtimeGeneration,
    api,
    isDisposed: () => disposed,
    recoverFromSequenceGap,
    recovery,
    removeOrphanedTerminalStates,
    syncProjects,
    syncServerReadModel,
    syncThreads,
  })
  runSnapshotRecovery = createRunSnapshotRecovery(snapshotRecoveryContext)
  const recoveryActions = createRuntimeRecoveryActions(snapshotRecoveryContext)

  return {
    applyEventBatch,
    dispose: () => {
      disposed = true
    },
    isDisposed: () => disposed,
    providerInvalidationState,
    queryInvalidationThrottler,
    recoverFromSequenceGap,
    recovery,
    runConnectionReconcile: recoveryActions.runConnectionReconcile,
    runForegroundReconcile: recoveryActions.runForegroundReconcile,
    runSnapshotRecovery,
  }
}
