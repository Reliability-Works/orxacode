import { ThreadId, type OrchestrationEvent } from '@orxa-code/contracts'
import type { QueryClient } from '@tanstack/react-query'
import { Throttler } from '@tanstack/react-pacer'
import { readNativeApi } from '../nativeApi'
import { createOrchestrationRecoveryCoordinator } from '../orchestrationRecovery'
import { useStore } from '../store'
import { terminalRunningSubprocessFromEvent } from '../terminalActivity'
import { useTerminalStateStore } from '../terminalStateStore'
import { useUiStateStore } from '../uiStateStore'
import { type WsRpcClient, getWsRpcClient } from '../wsRpcClient'
import { registerForegroundReconcileListeners } from './-eventRouterConnectionLifecycle'
import { createRuntimeRecoveryPipeline } from './-eventRouterRecoveryPipeline'
import type { MutableRefObject } from 'react'
type NativeApi = NonNullable<ReturnType<typeof readNativeApi>>
type RecoveryCoordinator = ReturnType<typeof createOrchestrationRecoveryCoordinator>
type StoreState = ReturnType<typeof useStore.getState>
type UiState = ReturnType<typeof useUiStateStore.getState>
type TerminalState = ReturnType<typeof useTerminalStateStore.getState>
export type RuntimeSyncOptions = {
  activeEnvironmentId: string
  connectionId: number
  runtimeGeneration: number
  applyOrchestrationEvents: StoreState['applyOrchestrationEvents']
  bootstrapFromSnapshotRef: MutableRefObject<() => Promise<void>>
  clearThreadUi: UiState['clearThreadUi']
  disposedRef: { current: boolean }
  queryClient: QueryClient
  removeOrphanedTerminalStates: TerminalState['removeOrphanedTerminalStates']
  removeTerminalState: TerminalState['removeTerminalState']
  syncProjects: UiState['syncProjects']
  syncServerReadModel: StoreState['syncServerReadModel']
  syncThreads: UiState['syncThreads']
}

function logRuntimeSyncLifecycle(
  event: 'wired' | 'cleanup',
  input: {
    activeEnvironmentId: string
    connectionId: number
    runtimeGeneration: number
  }
) {
  const base = {
    revision: 'mobile-reopen-probe-1',
    connectionId: input.connectionId,
    environmentId: input.activeEnvironmentId,
    runtimeGeneration: input.runtimeGeneration,
  }
  console.info(`[mobile-sync] runtime sync ${event}`, base)
}

function wireRuntimeSyncBootstrap(params: {
  activeEnvironmentId: string
  bootstrapFromSnapshotRef: RuntimeSyncOptions['bootstrapFromSnapshotRef']
  connectionId: number
  runtime: ReturnType<typeof createRuntimeRecoveryPipeline>
  runtimeGeneration: number
}) {
  params.bootstrapFromSnapshotRef.current = params.runtime.runForegroundReconcile
  logRuntimeSyncLifecycle('wired', {
    activeEnvironmentId: params.activeEnvironmentId,
    connectionId: params.connectionId,
    runtimeGeneration: params.runtimeGeneration,
  })
}

function subscribeDomainEvents(
  onDomainEvent: WsRpcClient['orchestration']['onDomainEvent'],
  applyEventBatch: (events: ReadonlyArray<OrchestrationEvent>) => void,
  recoverFromSequenceGap: (reason: 'sequence-gap' | 'resubscribe') => Promise<void>,
  recovery: RecoveryCoordinator
) {
  return onDomainEvent(
    event => {
      const action = recovery.classifyDomainEvent(event.sequence)
      if (action === 'apply') {
        applyEventBatch([event])
        return
      }
      if (action === 'recover') {
        void recoverFromSequenceGap('sequence-gap')
      }
    },
    {
      onResubscribe: () => {
        void recoverFromSequenceGap('resubscribe')
      },
    }
  )
}

function subscribeTerminalEvents(api: NativeApi) {
  return api.terminal.onEvent(event => {
    const hasRunningSubprocess = terminalRunningSubprocessFromEvent(event)
    if (hasRunningSubprocess === null) {
      return
    }
    useTerminalStateStore
      .getState()
      .setTerminalActivity(
        ThreadId.makeUnsafe(event.threadId),
        event.terminalId,
        hasRunningSubprocess
      )
  })
}

function createRuntimeSyncCleanup({
  disposedRef,
  providerInvalidationState,
  queryInvalidationThrottler,
  removeForegroundReconcileListeners,
  unsubDomainEvent,
  unsubTerminalEvent,
}: {
  disposedRef: RuntimeSyncOptions['disposedRef']
  providerInvalidationState: { current: boolean }
  queryInvalidationThrottler: Throttler<() => void>
  removeForegroundReconcileListeners: () => void
  unsubDomainEvent: () => void
  unsubTerminalEvent: () => void
}) {
  return (dispose: () => void) => {
    dispose()
    disposedRef.current = true
    providerInvalidationState.current = false
    queryInvalidationThrottler.cancel()
    unsubDomainEvent()
    unsubTerminalEvent()
    removeForegroundReconcileListeners()
  }
}

export function setupEventRouterRuntimeSync({
  activeEnvironmentId,
  connectionId,
  runtimeGeneration,
  applyOrchestrationEvents,
  bootstrapFromSnapshotRef,
  clearThreadUi,
  disposedRef,
  queryClient,
  removeOrphanedTerminalStates,
  removeTerminalState,
  syncProjects,
  syncServerReadModel,
  syncThreads,
}: RuntimeSyncOptions) {
  const api = readNativeApi()
  if (!api) {
    return undefined
  }

  const runtime = createRuntimeRecoveryPipeline({
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
  })
  const rpcClient = getWsRpcClient()
  const unsubDomainEvent = subscribeDomainEvents(
    rpcClient.orchestration.onDomainEvent,
    runtime.applyEventBatch,
    runtime.recoverFromSequenceGap,
    runtime.recovery
  )
  const unsubTerminalEvent = subscribeTerminalEvents(api)
  const removeForegroundReconcileListeners = registerForegroundReconcileListeners(
    runtime.runConnectionReconcile,
    runtime.isDisposed
  )
  const cleanup = createRuntimeSyncCleanup({
    disposedRef,
    providerInvalidationState: runtime.providerInvalidationState,
    queryInvalidationThrottler: runtime.queryInvalidationThrottler,
    removeForegroundReconcileListeners: () => {
      removeForegroundReconcileListeners()
    },
    unsubDomainEvent,
    unsubTerminalEvent,
  })
  wireRuntimeSyncBootstrap({
    activeEnvironmentId,
    bootstrapFromSnapshotRef,
    connectionId,
    runtime,
    runtimeGeneration,
  })

  return () => {
    bootstrapFromSnapshotRef.current = async () => undefined
    logRuntimeSyncLifecycle('cleanup', {
      activeEnvironmentId,
      connectionId,
      runtimeGeneration,
    })
    cleanup(runtime.dispose)
  }
}
