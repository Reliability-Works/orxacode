import { type ServerLifecycleWelcomePayload } from '@orxa-code/contracts'
import { useCallback, useEffect } from 'react'
import type { MutableRefObject } from 'react'

import { toastManager } from '../components/ui/toastState'
import { resolveAndPersistPreferredEditor } from '../editorPreferences'
import { migrateLocalSettingsToServer } from '../hooks/useSettings'
import { readNativeApi } from '../nativeApi'
import { useUiStateStore } from '../uiStateStore'
import { type ServerConfigUpdateSource, useServerConfig } from '../rpc/serverState'
import { setupEventRouterRuntimeSync, type RuntimeSyncOptions } from './-eventRouterRuntimeSync'

type NavigateToThread = (threadId: string) => Promise<void>
type UiState = ReturnType<typeof useUiStateStore.getState>

type WelcomeHandlerOptions = {
  connectionId: number
  bootstrapFromSnapshotRef: MutableRefObject<() => Promise<void>>
  disposedRef: MutableRefObject<boolean>
  handledBootstrapThreadIdRef: MutableRefObject<string | null>
  navigateToThread: NavigateToThread
  pathnameRef: MutableRefObject<string>
  runtimeGeneration: number
  setProjectExpanded: UiState['setProjectExpanded']
}

type ServerConfigUpdatedHandlerOptions = {
  handledConfigReplayRef: MutableRefObject<boolean>
  serverConfig: ReturnType<typeof useServerConfig>
}

export function useEventRouterWelcomeHandler({
  connectionId,
  bootstrapFromSnapshotRef,
  disposedRef,
  handledBootstrapThreadIdRef,
  navigateToThread,
  pathnameRef,
  runtimeGeneration,
  setProjectExpanded,
}: WelcomeHandlerOptions) {
  return useCallback(
    (payload: ServerLifecycleWelcomePayload) => {
      console.info('[mobile-sync] welcome handler invoked', {
        revision: 'mobile-reopen-probe-1',
        connectionId,
        runtimeGeneration,
        pathname: pathnameRef.current,
        bootstrapProjectId: payload.bootstrapProjectId ?? null,
        bootstrapThreadId: payload.bootstrapThreadId ?? null,
      })
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
      })().catch(error => {
        console.error('[mobile-sync] welcome handler error', {
          revision: 'mobile-reopen-probe-1',
          connectionId,
          runtimeGeneration,
          error,
        })
      })
    },
    [
      connectionId,
      bootstrapFromSnapshotRef,
      disposedRef,
      handledBootstrapThreadIdRef,
      navigateToThread,
      pathnameRef,
      runtimeGeneration,
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
  const {
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
  } = options

  useEffect(
    () =>
      setupEventRouterRuntimeSync({
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
      }),
    [
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
    ]
  )
}
