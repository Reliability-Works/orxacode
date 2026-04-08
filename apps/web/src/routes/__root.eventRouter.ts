import {
  ThreadId,
  type OrchestrationEvent,
  type ServerLifecycleWelcomePayload,
} from '@orxa-code/contracts'
import { useCallback, useEffect } from 'react'
import type { MutableRefObject } from 'react'
import { Throttler } from '@tanstack/react-pacer'
import type { QueryClient } from '@tanstack/react-query'

import {
  clearPromotedDraftThread,
  clearPromotedDraftThreads,
  useComposerDraftStore,
} from '../composerDraftStore'
import { toastManager } from '../components/ui/toastState'
import { resolveAndPersistPreferredEditor } from '../editorPreferences'
import { migrateLocalSettingsToServer } from '../hooks/useSettings'
import { projectQueryKeys } from '../lib/projectReactQuery'
import { providerQueryKeys } from '../lib/providerReactQuery'
import { collectActiveTerminalThreadIds } from '../lib/terminalStateCleanup'
import { readNativeApi } from '../nativeApi'
import { deriveOrchestrationBatchEffects } from '../orchestrationEventEffects'
import { createOrchestrationRecoveryCoordinator } from '../orchestrationRecovery'
import { type ServerConfigUpdateSource, useServerConfig } from '../rpc/serverState'
import { useStore } from '../store'
import { terminalRunningSubprocessFromEvent } from '../terminalActivity'
import { useTerminalStateStore } from '../terminalStateStore'
import { useUiStateStore } from '../uiStateStore'

type NavigateToThread = (threadId: string) => Promise<void>
type NativeApi = NonNullable<ReturnType<typeof readNativeApi>>
type RecoveryCoordinator = ReturnType<typeof createOrchestrationRecoveryCoordinator>
type StoreState = ReturnType<typeof useStore.getState>
type UiState = ReturnType<typeof useUiStateStore.getState>
type TerminalState = ReturnType<typeof useTerminalStateStore.getState>
type BatchEffects = ReturnType<typeof deriveOrchestrationBatchEffects>

type WelcomeHandlerOptions = {
  bootstrapFromSnapshotRef: MutableRefObject<() => Promise<void>>
  disposedRef: MutableRefObject<boolean>
  handledBootstrapThreadIdRef: MutableRefObject<string | null>
  navigateToThread: NavigateToThread
  pathnameRef: MutableRefObject<string>
  setProjectExpanded: UiState['setProjectExpanded']
}

type ServerConfigUpdatedHandlerOptions = {
  handledConfigReplayRef: MutableRefObject<boolean>
  serverConfig: ReturnType<typeof useServerConfig>
}

type RuntimeSyncOptions = {
  applyOrchestrationEvents: StoreState['applyOrchestrationEvents']
  clearThreadUi: UiState['clearThreadUi']
  disposedRef: MutableRefObject<boolean>
  queryClient: QueryClient
  removeOrphanedTerminalStates: TerminalState['removeOrphanedTerminalStates']
  removeTerminalState: TerminalState['removeTerminalState']
  syncProjects: UiState['syncProjects']
  syncServerReadModel: StoreState['syncServerReadModel']
  syncThreads: UiState['syncThreads']
}

function syncProjectsFromStore(syncProjects: RuntimeSyncOptions['syncProjects']) {
  const projects = useStore.getState().projects
  syncProjects(projects.map(project => ({ id: project.id, cwd: project.cwd })))
}

function syncThreadsFromStore(syncThreads: RuntimeSyncOptions['syncThreads']) {
  const threads = useStore.getState().threads
  syncThreads(
    threads.map(thread => ({
      id: thread.id,
      seedVisitedAt: thread.updatedAt ?? thread.createdAt,
    }))
  )
}

function reconcileSnapshotDerivedState(
  removeOrphanedTerminalStates: RuntimeSyncOptions['removeOrphanedTerminalStates'],
  syncProjects: RuntimeSyncOptions['syncProjects'],
  syncThreads: RuntimeSyncOptions['syncThreads']
) {
  const threads = useStore.getState().threads
  syncProjectsFromStore(syncProjects)
  syncThreadsFromStore(syncThreads)
  clearPromotedDraftThreads(threads.map(thread => thread.id))
  const draftThreadIds = Object.keys(
    useComposerDraftStore.getState().draftThreadsByThreadId
  ) as ThreadId[]
  const activeThreadIds = collectActiveTerminalThreadIds({
    snapshotThreads: threads.map(thread => ({ id: thread.id, deletedAt: null })),
    draftThreadIds,
  })
  removeOrphanedTerminalStates(activeThreadIds)
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
  api,
  isDisposed,
  recovery,
  recoverFromSequenceGap,
  removeOrphanedTerminalStates,
  syncProjects,
  syncServerReadModel,
  syncThreads,
}: {
  api: NativeApi
  isDisposed: () => boolean
  recoverFromSequenceGap: () => Promise<void>
  recovery: RecoveryCoordinator
  removeOrphanedTerminalStates: RuntimeSyncOptions['removeOrphanedTerminalStates']
  syncProjects: RuntimeSyncOptions['syncProjects']
  syncServerReadModel: RuntimeSyncOptions['syncServerReadModel']
  syncThreads: RuntimeSyncOptions['syncThreads']
}) {
  return async (reason: 'bootstrap' | 'replay-failed') => {
    if (!recovery.beginSnapshotRecovery(reason)) {
      return
    }
    try {
      const snapshot = await api.orchestration.getSnapshot()
      if (!isDisposed()) {
        syncServerReadModel(snapshot)
        reconcileSnapshotDerivedState(removeOrphanedTerminalStates, syncProjects, syncThreads)
        if (recovery.completeSnapshotRecovery(snapshot.snapshotSequence)) {
          await recoverFromSequenceGap()
        }
      }
    } catch {
      recovery.failSnapshotRecovery()
    }
  }
}

function createRecoverFromSequenceGap({
  api,
  applyEventBatch,
  isDisposed,
  recovery,
  runSnapshotRecovery,
}: {
  api: NativeApi
  applyEventBatch: (events: ReadonlyArray<OrchestrationEvent>) => void
  isDisposed: () => boolean
  recovery: RecoveryCoordinator
  runSnapshotRecovery: (reason: 'bootstrap' | 'replay-failed') => Promise<void>
}) {
  return async function recoverFromSequenceGap(): Promise<void> {
    if (!recovery.beginReplayRecovery('sequence-gap')) {
      return
    }
    try {
      const events = await api.orchestration.replayEvents(recovery.getState().latestSequence)
      if (!isDisposed()) {
        applyEventBatch(events)
      }
    } catch {
      recovery.failReplayRecovery()
      await runSnapshotRecovery('replay-failed')
      return
    }
    if (!isDisposed() && recovery.completeReplayRecovery()) {
      await recoverFromSequenceGap()
    }
  }
}

function subscribeDomainEvents(
  api: NativeApi,
  applyEventBatch: (events: ReadonlyArray<OrchestrationEvent>) => void,
  recoverFromSequenceGap: () => Promise<void>,
  recovery: RecoveryCoordinator
) {
  return api.orchestration.onDomainEvent(event => {
    const action = recovery.classifyDomainEvent(event.sequence)
    if (action === 'apply') {
      applyEventBatch([event])
      return
    }
    if (action === 'recover') {
      void recoverFromSequenceGap()
    }
  })
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

function setupEventRouterRuntimeSync({
  applyOrchestrationEvents,
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
  runSnapshotRecovery = createRunSnapshotRecovery({
    api,
    isDisposed: () => disposed,
    recoverFromSequenceGap,
    recovery,
    removeOrphanedTerminalStates,
    syncProjects,
    syncServerReadModel,
    syncThreads,
  })

  const unsubDomainEvent = subscribeDomainEvents(
    api,
    applyEventBatch,
    recoverFromSequenceGap,
    recovery
  )
  const unsubTerminalEvent = subscribeTerminalEvents(api)
  void runSnapshotRecovery('bootstrap')

  return () => {
    disposed = true
    disposedRef.current = true
    providerInvalidationState.current = false
    queryInvalidationThrottler.cancel()
    unsubDomainEvent()
    unsubTerminalEvent()
  }
}

export function useEventRouterWelcomeHandler({
  bootstrapFromSnapshotRef,
  disposedRef,
  handledBootstrapThreadIdRef,
  navigateToThread,
  pathnameRef,
  setProjectExpanded,
}: WelcomeHandlerOptions) {
  return useCallback(
    (payload: ServerLifecycleWelcomePayload) => {
      migrateLocalSettingsToServer()
      void (async () => {
        await bootstrapFromSnapshotRef.current()
        if (disposedRef.current || !payload.bootstrapProjectId || !payload.bootstrapThreadId) {
          return
        }
        setProjectExpanded(payload.bootstrapProjectId, true)
        if (pathnameRef.current !== '/') {
          return
        }
        if (handledBootstrapThreadIdRef.current === payload.bootstrapThreadId) {
          return
        }
        await navigateToThread(payload.bootstrapThreadId)
        handledBootstrapThreadIdRef.current = payload.bootstrapThreadId
      })().catch(() => undefined)
    },
    [
      bootstrapFromSnapshotRef,
      disposedRef,
      handledBootstrapThreadIdRef,
      navigateToThread,
      pathnameRef,
      setProjectExpanded,
    ]
  )
}

export function useEventRouterServerConfigUpdatedHandler({
  handledConfigReplayRef,
  serverConfig,
}: ServerConfigUpdatedHandlerOptions) {
  return useCallback(
    ({
      payload,
      source,
    }: {
      readonly payload: import('@orxa-code/contracts').ServerConfigUpdatedPayload
      readonly source: ServerConfigUpdateSource
    }) => {
      const isReplay = !handledConfigReplayRef.current
      handledConfigReplayRef.current = true
      if (isReplay || source !== 'keybindingsUpdated') {
        return
      }

      const issue = payload.issues.find(entry => entry.kind.startsWith('keybindings.'))
      if (!issue) {
        toastManager.add({
          type: 'success',
          title: 'Keybindings updated',
          description: 'Keybindings configuration reloaded successfully.',
        })
        return
      }

      toastManager.add({
        type: 'warning',
        title: 'Invalid keybindings configuration',
        description: issue.message,
        actionProps: {
          children: 'Open keybindings.json',
          onClick: () => {
            const api = readNativeApi()
            if (!api) {
              return
            }
            void Promise.resolve(serverConfig ?? api.server.getConfig())
              .then(config => {
                const editor = resolveAndPersistPreferredEditor(config.availableEditors)
                if (!editor) {
                  throw new Error('No available editors found.')
                }
                return api.shell.openInEditor(config.keybindingsConfigPath, editor)
              })
              .catch(error => {
                toastManager.add({
                  type: 'error',
                  title: 'Unable to open keybindings file',
                  description:
                    error instanceof Error ? error.message : 'Unknown error opening file.',
                })
              })
          },
        },
      })
    },
    [handledConfigReplayRef, serverConfig]
  )
}

export function useEventRouterRuntimeSync(options: RuntimeSyncOptions) {
  useEffect(() => setupEventRouterRuntimeSync(options), [options])
}
