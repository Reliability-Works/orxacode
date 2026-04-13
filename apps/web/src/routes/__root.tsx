import {
  Outlet,
  createRootRouteWithContext,
  type ErrorComponentProps,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { QueryClient, useQueryClient } from '@tanstack/react-query'

import { APP_DISPLAY_NAME } from '../branding'
import { AppSidebarLayout } from '../components/AppSidebarLayout'
import {
  WebSocketConnectionCoordinator,
  WebSocketConnectionSurface,
} from '../components/WebSocketConnectionSurface'
import { Button } from '../components/ui/button'
import { AnchoredToastProvider, ToastProvider } from '../components/ui/toast'
import {
  getActiveEnvironmentConnection,
  getActiveEnvironmentConnectionOrNull,
  getEnvironmentRuntimeDebugState,
  initializePrimaryEnvironmentRuntime,
} from '../environments/runtime'
import { fetchRemoteMobileSyncBootstrap } from '../environments/remote'
import {
  peekPairingTokenFromUrl,
  resolveInitialPrimaryAuthGateState,
  tryResolveInitialPrimaryEnvironmentDescriptor,
} from '../environments/primary'
import { resolveRootRuntimeBootStrategy } from './rootRuntimeBootStrategy'
import {
  getServerConfig,
  setServerConfigSnapshot,
  startServerStateSync,
  useServerConfig,
  useServerConfigUpdatedSubscription,
  useServerWelcomeSubscription,
} from '../rpc/serverState'
import { useStore } from '../store'
import { useUiStateStore } from '../uiStateStore'
import { useTerminalStateStore } from '../terminalStateStore'
import {
  useEventRouterRuntimeSync,
  useEventRouterServerConfigUpdatedHandler,
  useEventRouterWelcomeHandler,
} from './-__root.eventRouter'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  beforeLoad: async () => {
    const [environmentDescriptor, authGateState] = await Promise.all([
      tryResolveInitialPrimaryEnvironmentDescriptor(),
      resolveInitialPrimaryAuthGateState(),
    ])

    return {
      authGateState,
      environmentDescriptor,
    }
  },
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  head: () => ({
    meta: [{ name: 'title', content: APP_DISPLAY_NAME }],
  }),
})

function RootRouteView() {
  const pathname = useLocation({ select: location => location.pathname })
  const { authGateState } = Route.useRouteContext()

  if (pathname === '/pair') {
    return <Outlet />
  }

  return (
    <RootRuntimeBootstrap authGateState={authGateState}>
      <RootRouteApp />
    </RootRuntimeBootstrap>
  )
}

function RootRuntimeBootstrap({
  authGateState,
  children,
}: {
  authGateState: Awaited<ReturnType<typeof resolveInitialPrimaryAuthGateState>>
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { bootState, errorMessage } = useRootRuntimeBoot(authGateState.status, navigate)

  if (bootState === 'ready') {
    return <>{children}</>
  }

  return <RootRuntimeBootSurface bootState={bootState} errorMessage={errorMessage} />
}

function useRootRuntimeBoot(
  authStatus: Awaited<ReturnType<typeof resolveInitialPrimaryAuthGateState>>['status'],
  navigate: ReturnType<typeof useNavigate>
) {
  const [bootState, setBootState] = useState<'booting' | 'ready' | 'redirecting' | 'error'>(
    'booting'
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      try {
        if (getActiveEnvironmentConnectionOrNull()) {
          if (!cancelled) {
            console.info('[mobile-sync] root boot ready', {
              revision: 'mobile-reopen-probe-1',
              runtime: getEnvironmentRuntimeDebugState(),
            })
            setBootState('ready')
          }
          return
        }
        const strategy = resolveRootRuntimeBootStrategy({
          authStatus,
          hasDesktopManagedPrimary: Boolean(window.desktopBridge?.getLocalEnvironmentBootstrap),
          hasPairingToken: Boolean(peekPairingTokenFromUrl()),
        })
        console.info('[mobile-sync] root boot strategy', {
          revision: 'mobile-reopen-probe-1',
          authStatus,
          strategy,
          hasPairingToken: Boolean(peekPairingTokenFromUrl()),
          existingConnectionId: getActiveEnvironmentConnectionOrNull()?.connectionId ?? null,
          existingEnvironmentId: getActiveEnvironmentConnectionOrNull()?.environmentId ?? null,
          runtime: getEnvironmentRuntimeDebugState(),
        })

        if (strategy === 'primary') {
          await initializePrimaryEnvironmentRuntime('root-boot-primary')
        } else {
          if (!cancelled) {
            setBootState('redirecting')
            await navigate({ to: '/pair', replace: true })
          }
          return
        }

        if (!cancelled) {
          console.info('[mobile-sync] root boot ready', {
            revision: 'mobile-reopen-probe-1',
            runtime: getEnvironmentRuntimeDebugState(),
          })
          setBootState('ready')
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[mobile-sync] root boot error', {
            revision: 'mobile-reopen-probe-1',
            error,
            runtime: getEnvironmentRuntimeDebugState(),
          })
          setErrorMessage(
            error instanceof Error ? error.message : 'Unable to initialize the environment runtime.'
          )
          setBootState('error')
        }
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [authStatus, navigate])

  return { bootState, errorMessage }
}

function RootRuntimeBootSurface(props: {
  bootState: 'booting' | 'ready' | 'redirecting' | 'error'
  errorMessage: string | null
}) {
  const title =
    props.bootState === 'redirecting'
      ? 'Opening pairing flow…'
      : window.desktopBridge?.getLocalEnvironmentBootstrap
        ? 'Opening Orxa Code…'
        : 'Connecting to your Mac…'
  const description =
    props.bootState === 'error'
      ? props.errorMessage ?? 'Unable to initialize the environment runtime.'
      : props.bootState === 'redirecting'
        ? 'No active session is available yet. Redirecting to pair your phone.'
        : 'Preparing the active environment before the app opens.'

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          {props.bootState === 'error' ? (
            <Button className="mt-4" size="sm" onClick={() => window.location.reload()}>
              Retry startup
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function RootRouteApp() {
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <ServerStateBootstrap />
        <EventRouter />
        <WebSocketConnectionCoordinator />
        <WebSocketConnectionSurface>
          <AppSidebarLayout>
            <Outlet />
          </AppSidebarLayout>
        </WebSocketConnectionSurface>
      </AnchoredToastProvider>
    </ToastProvider>
  )
}

function ServerStateBootstrap() {
  useEffect(() => {
    const connection = getActiveEnvironmentConnection()
    console.info('[mobile-sync] server state bootstrap start', {
      revision: 'mobile-reopen-probe-1',
      connectionId: connection.connectionId,
      environmentId: connection.environmentId,
      runtime: getEnvironmentRuntimeDebugState(),
    })
    const stop = startServerStateSync(connection.client.server)
    const bootstrapFallbackTimer =
      connection.kind === 'saved' && connection.bearerToken
        ? window.setTimeout(() => {
            const bearerToken = connection.bearerToken
            if (!bearerToken) {
              return
            }
            const hasServerConfig = getServerConfig() !== null
            const isBootstrapped = useStore.getState().bootstrapComplete
            if (hasServerConfig && isBootstrapped) {
              return
            }

            console.warn('[mobile-sync] bootstrap http fallback start', {
              revision: 'mobile-reopen-probe-1',
              connectionId: connection.connectionId,
              environmentId: connection.environmentId,
              hasServerConfig,
              isBootstrapped,
            })

            void fetchRemoteMobileSyncBootstrap({
              httpBaseUrl: connection.httpBaseUrl,
              bearerToken,
            })
              .then(({ config, readModel }) => {
                setServerConfigSnapshot(config)
                useStore.getState().syncServerReadModel(readModel, connection.environmentId)
                console.info('[mobile-sync] bootstrap http fallback done', {
                  revision: 'mobile-reopen-probe-1',
                  connectionId: connection.connectionId,
                  environmentId: connection.environmentId,
                  snapshotSequence: readModel.snapshotSequence,
                  projects: readModel.projects.length,
                  threads: readModel.threads.length,
                })
              })
              .catch(error => {
                console.error('[mobile-sync] bootstrap http fallback error', {
                  revision: 'mobile-reopen-probe-1',
                  connectionId: connection.connectionId,
                  environmentId: connection.environmentId,
                  error,
                })
              })
          }, 3500)
        : null
    return () => {
      if (bootstrapFallbackTimer !== null) {
        window.clearTimeout(bootstrapFallbackTimer)
      }
      console.info('[mobile-sync] server state bootstrap stop', {
        revision: 'mobile-reopen-probe-1',
        connectionId: connection.connectionId,
        environmentId: connection.environmentId,
        runtime: getEnvironmentRuntimeDebugState(),
      })
      stop()
    }
  }, [])

  return null
}

function RootRouteErrorView({ error, reset }: ErrorComponentProps) {
  const message = errorMessage(error)
  const details = errorDetails(error)

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-red-500)_16%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Something went wrong.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => reset()}>
            Try again
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload app
          </Button>
        </div>

        <details className="group mt-5 overflow-hidden rounded-lg border border-border/70 bg-background/55">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground">
            <span className="group-open:hidden">Show error details</span>
            <span className="hidden group-open:inline">Hide error details</span>
          </summary>
          <pre className="max-h-56 overflow-auto border-t border-border/70 bg-background/80 px-3 py-2 text-xs text-foreground/85">
            {details}
          </pre>
        </details>
      </section>
    </div>
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  return 'An unexpected router error occurred.'
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return 'No additional error details are available.'
  }
}

function useEventRouterMountLogging(input: {
  activeEnvironmentId: string
  connectionId: number
  pathname: string
  pathnameRef: MutableRefObject<string>
  runtimeGeneration: number
}) {
  useEffect(() => {
    console.info('[mobile-sync] EventRouter mount', {
      revision: 'mobile-reopen-probe-1',
      connectionId: input.connectionId,
      environmentId: input.activeEnvironmentId,
      runtimeGeneration: input.runtimeGeneration,
      pathname: input.pathname,
    })
    return () => {
      console.info('[mobile-sync] EventRouter unmount', {
        revision: 'mobile-reopen-probe-1',
        connectionId: input.connectionId,
        environmentId: input.activeEnvironmentId,
        runtimeGeneration: input.runtimeGeneration,
        pathname: input.pathnameRef.current,
      })
    }
  }, [
    input.activeEnvironmentId,
    input.connectionId,
    input.pathname,
    input.pathnameRef,
    input.runtimeGeneration,
  ])
}

function useEventRouterPathnameRef(pathname: string) {
  const pathnameRef = useRef(pathname)
  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])
  return pathnameRef
}

function useEventRouterActiveEnvironmentIdSync(activeEnvironmentId: string) {
  const setActiveEnvironmentId = useStore(store => store.setActiveEnvironmentId)
  useEffect(() => {
    setActiveEnvironmentId(activeEnvironmentId)
  }, [activeEnvironmentId, setActiveEnvironmentId])
}

function getEventRouterConnectionBinding() {
  const activeConnection = getActiveEnvironmentConnection()
  return {
    activeEnvironmentId: activeConnection.environmentId,
    connectionId: activeConnection.connectionId,
    runtimeGeneration: getEnvironmentRuntimeDebugState().runtimeGeneration,
  }
}

function EventRouter() {
  const applyOrchestrationEvents = useStore(store => store.applyOrchestrationEvents)
  const syncServerReadModel = useStore(store => store.syncServerReadModel)
  const setProjectExpanded = useUiStateStore(store => store.setProjectExpanded)
  const syncProjects = useUiStateStore(store => store.syncProjects)
  const syncThreads = useUiStateStore(store => store.syncThreads)
  const clearThreadUi = useUiStateStore(store => store.clearThreadUi)
  const removeTerminalState = useTerminalStateStore(store => store.removeTerminalState)
  const removeOrphanedTerminalStates = useTerminalStateStore(
    store => store.removeOrphanedTerminalStates
  )
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const pathname = useLocation({ select: loc => loc.pathname })
  const pathnameRef = useEventRouterPathnameRef(pathname)
  const handledBootstrapThreadIdRef = useRef<string | null>(null)
  const handledConfigReplayRef = useRef(false)
  const disposedRef = useRef(false)
  const bootstrapFromSnapshotRef = useRef<() => Promise<void>>(async () => undefined)
  const serverConfig = useServerConfig()
  const { activeEnvironmentId, connectionId, runtimeGeneration } =
    getEventRouterConnectionBinding()

  useEventRouterActiveEnvironmentIdSync(activeEnvironmentId)
  useEventRouterMountLogging({
    activeEnvironmentId,
    connectionId,
    pathname,
    pathnameRef,
    runtimeGeneration,
  })

  const navigateToThread = async (threadId: string) => {
    await navigate({
      to: '/$threadId',
      params: { threadId },
      replace: true,
    })
  }

  const handleWelcome = useEventRouterWelcomeHandler({
    connectionId,
    bootstrapFromSnapshotRef,
    disposedRef,
    handledBootstrapThreadIdRef,
    navigateToThread,
    pathnameRef,
    runtimeGeneration,
    setProjectExpanded,
  })

  const handleServerConfigUpdated = useEventRouterServerConfigUpdatedHandler({
    handledConfigReplayRef,
    serverConfig,
  })

  useEventRouterRuntimeSync({
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
  })

  useServerWelcomeSubscription(handleWelcome)
  useServerConfigUpdatedSubscription(handleServerConfigUpdated)

  return null
}
