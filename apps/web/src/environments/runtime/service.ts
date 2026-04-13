import { useSyncExternalStore } from 'react'

import { setActiveEnvironmentHttpOrigin } from '../../environmentRuntimeState'
import { localPersistence } from '../../localPersistence'
import { setMobileSyncLogRelayContext } from '../../mobileSyncLogRelay'
import { setActiveNativeApi } from '../../nativeApi'
import { setActiveWsRpcClient, createWsRpcClient } from '../../wsRpcClient'
import { createWsNativeApiForRpcClient } from '../../wsNativeApi'
import { bootstrapRemoteBearerSession, fetchRemoteEnvironmentDescriptor, resolveRemotePairingTarget, resolveRemoteWebSocketConnectionUrl } from '../remote'
import { getPrimaryKnownEnvironment, resolvePrimaryWebSocketConnectionUrl } from '../primary'
import { WsTransport } from '../../wsTransport'
import type { ActiveEnvironmentConnection } from './connection'

export type EnvironmentRuntimeState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export interface EnvironmentRuntimeSnapshot {
  readonly state: EnvironmentRuntimeState
  readonly activeEnvironmentId: string | null
  readonly activeEnvironmentKind: 'primary' | 'saved' | null
  readonly error: string | null
}

export interface EnvironmentRuntimeDebugState {
  readonly activeConnectionId: number | null
  readonly activeEnvironmentId: string | null
  readonly activeEnvironmentKind: 'primary' | 'saved' | null
  readonly runtimeGeneration: number
}

const listeners = new Set<() => void>()

let primaryConnection: ActiveEnvironmentConnection | null = null
let activeConnection: ActiveEnvironmentConnection | null = null
let nextConnectionId = 1
let runtimeGeneration = 0
let runtimeState: EnvironmentRuntimeState = 'idle'
let runtimeError: string | null = null
let runtimeSnapshot: EnvironmentRuntimeSnapshot = {
  state: runtimeState,
  activeEnvironmentId: null,
  activeEnvironmentKind: null,
  error: runtimeError,
}

function logRuntime(event: string, data: Record<string, unknown>) {
  if (typeof window === 'undefined') {
    return
  }

  console.info('[mobile-sync] runtime', {
    event,
    revision: 'mobile-reopen-probe-1',
    ...data,
  })
}

function logRuntimeError(event: string, data: Record<string, unknown>) {
  if (typeof window === 'undefined') {
    return
  }

  console.error('[mobile-sync] runtime', {
    event,
    revision: 'mobile-reopen-probe-1',
    ...data,
  })
}

function createAuthRevision(token: string): string {
  return `${token.length}:${token.slice(-8)}`
}

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

function updateSnapshot(
  nextState: EnvironmentRuntimeState,
  nextConnection: ActiveEnvironmentConnection | null,
  nextError: string | null
) {
  runtimeState = nextState
  runtimeError = nextError
  runtimeSnapshot = {
    state: nextState,
    activeEnvironmentId: nextConnection?.environmentId ?? null,
    activeEnvironmentKind: nextConnection?.kind ?? null,
    error: nextError,
  }
  emit()
}

function activateConnection(connection: ActiveEnvironmentConnection | null, source: string) {
  const previousConnection = activeConnection
  if (previousConnection !== connection) {
    runtimeGeneration += 1
  }
  activeConnection = connection
  setActiveWsRpcClient(connection?.client ?? null)
  setActiveNativeApi(connection?.nativeApi)
  setActiveEnvironmentHttpOrigin(connection?.httpBaseUrl ?? null)
  setMobileSyncLogRelayContext(
    connection?.kind === 'saved' && connection.bearerToken
      ? {
          httpBaseUrl: connection.httpBaseUrl,
          bearerToken: connection.bearerToken,
        }
      : null
  )
  logRuntime('activate-connection', {
    source,
    runtimeGeneration,
    previousConnectionId: previousConnection?.connectionId ?? null,
    previousEnvironmentId: previousConnection?.environmentId ?? null,
    nextConnectionId: connection?.connectionId ?? null,
    nextEnvironmentId: connection?.environmentId ?? null,
    nextEnvironmentKind: connection?.kind ?? null,
  })
}

async function switchActiveConnection(connection: ActiveEnvironmentConnection, source: string) {
  if (activeConnection && activeConnection !== connection) {
    logRuntime('switch-active-connection-dispose-previous', {
      source,
      runtimeGeneration,
      previousConnectionId: activeConnection.connectionId,
      previousEnvironmentId: activeConnection.environmentId,
      nextConnectionId: connection.connectionId,
      nextEnvironmentId: connection.environmentId,
    })
    if (activeConnection === primaryConnection) {
      primaryConnection = null
    }
    await disposeConnection(activeConnection)
  }
  activateConnection(connection, source)
}

async function disposeConnection(connection: ActiveEnvironmentConnection | null) {
  if (!connection) {
    return
  }
  logRuntime('dispose-connection-start', {
    runtimeGeneration,
    connectionId: connection.connectionId,
    environmentId: connection.environmentId,
    environmentKind: connection.kind,
  })
  await connection.dispose()
  logRuntime('dispose-connection-done', {
    runtimeGeneration,
    connectionId: connection.connectionId,
    environmentId: connection.environmentId,
    environmentKind: connection.kind,
  })
}

function createPrimaryEnvironmentConnection(): ActiveEnvironmentConnection {
  const knownEnvironment = getPrimaryKnownEnvironment()
  if (!knownEnvironment?.environmentId) {
    throw new Error('Unable to resolve the primary environment.')
  }

  const transport = new WsTransport(() =>
    resolvePrimaryWebSocketConnectionUrl(knownEnvironment.target.wsBaseUrl)
  )
  const client = createWsRpcClient(transport)
  return {
    connectionId: nextConnectionId++,
    authRevision: null,
    environmentId: knownEnvironment.environmentId,
    kind: 'primary',
    label: knownEnvironment.label,
    httpBaseUrl: knownEnvironment.target.httpBaseUrl,
    wsBaseUrl: knownEnvironment.target.wsBaseUrl,
    bearerToken: null,
    client,
    nativeApi: createWsNativeApiForRpcClient(client),
    dispose: async () => {
      await client.dispose()
    },
  }
}

function createRemoteEnvironmentConnection(input: {
  readonly bearerToken: string
  readonly environmentId: string
  readonly httpBaseUrl: string
  readonly label: string
  readonly wsBaseUrl: string
}): ActiveEnvironmentConnection {
  const transport = new WsTransport(async () =>
    resolveRemoteWebSocketConnectionUrl({
      wsBaseUrl: input.wsBaseUrl,
      bearerToken: input.bearerToken,
    })
  )
  const client = createWsRpcClient(transport)

  return {
    connectionId: nextConnectionId++,
    authRevision: createAuthRevision(input.bearerToken),
    environmentId: input.environmentId,
    kind: 'saved',
    label: input.label,
    httpBaseUrl: input.httpBaseUrl,
    wsBaseUrl: input.wsBaseUrl,
    bearerToken: input.bearerToken,
    client,
    nativeApi: createWsNativeApiForRpcClient(client),
    dispose: async () => {
      await client.dispose()
    },
  }
}

function clearSavedEnvironmentPersistence() {
  localPersistence.clearSavedEnvironmentState()
}

async function connectPrimaryEnvironment(source: string): Promise<ActiveEnvironmentConnection> {
  const nextConnection = primaryConnection ?? createPrimaryEnvironmentConnection()
  primaryConnection = nextConnection
  logRuntime('connect-primary-environment', {
    source,
    connectionId: nextConnection.connectionId,
    environmentId: nextConnection.environmentId,
  })
  await switchActiveConnection(nextConnection, source)
  updateSnapshot('connected', nextConnection, null)
  return nextConnection
}

export function getEnvironmentRuntimeSnapshot(): EnvironmentRuntimeSnapshot {
  return runtimeSnapshot
}

export function subscribeEnvironmentRuntime(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useEnvironmentRuntimeSnapshot(): EnvironmentRuntimeSnapshot {
  return useSyncExternalStore(subscribeEnvironmentRuntime, getEnvironmentRuntimeSnapshot)
}

export function getActiveEnvironmentConnection(): ActiveEnvironmentConnection {
  if (!activeConnection) {
    throw new Error('No active environment connection.')
  }
  return activeConnection
}

export function getActiveEnvironmentConnectionOrNull(): ActiveEnvironmentConnection | null {
  return activeConnection
}

export function getEnvironmentRuntimeDebugState(): EnvironmentRuntimeDebugState {
  return {
    activeConnectionId: activeConnection?.connectionId ?? null,
    activeEnvironmentId: activeConnection?.environmentId ?? null,
    activeEnvironmentKind: activeConnection?.kind ?? null,
    runtimeGeneration,
  }
}

export async function initializePrimaryEnvironmentRuntime(
  source = 'unspecified'
): Promise<ActiveEnvironmentConnection> {
  logRuntime('initialize-primary-start', {
    source,
    runtimeGeneration,
    activeConnectionId: activeConnection?.connectionId ?? null,
    activeEnvironmentId: activeConnection?.environmentId ?? null,
  })
  updateSnapshot('connecting', activeConnection, null)
  try {
    const connection = await connectPrimaryEnvironment(source)
    logRuntime('initialize-primary-done', {
      source,
      runtimeGeneration,
      activeConnectionId: connection.connectionId,
      activeEnvironmentId: connection.environmentId,
    })
    return connection
  } catch (error) {
    logRuntimeError('initialize-primary-error', {
      source,
      runtimeGeneration,
      activeConnectionId: activeConnection?.connectionId ?? null,
      activeEnvironmentId: activeConnection?.environmentId ?? null,
      error,
    })
    updateSnapshot(
      'error',
      activeConnection,
      error instanceof Error ? error.message : 'Unable to connect to the primary environment.'
    )
    throw error
  }
}

export async function connectRemoteEnvironment(
  input: {
    readonly host?: string
    readonly label?: string
    readonly pairingCode?: string
    readonly pairingUrl?: string
  },
  source = 'unspecified'
): Promise<ActiveEnvironmentConnection> {
  logRuntime('connect-remote-start', {
    source,
    runtimeGeneration,
    activeConnectionId: activeConnection?.connectionId ?? null,
    activeEnvironmentId: activeConnection?.environmentId ?? null,
  })
  updateSnapshot('connecting', activeConnection, null)

  try {
    clearSavedEnvironmentPersistence()
    const resolvedTarget = resolveRemotePairingTarget({
      ...(input.pairingUrl !== undefined ? { pairingUrl: input.pairingUrl } : {}),
      ...(input.host !== undefined ? { host: input.host } : {}),
      ...(input.pairingCode !== undefined ? { pairingCode: input.pairingCode } : {}),
    })
    const descriptor = await fetchRemoteEnvironmentDescriptor({
      httpBaseUrl: resolvedTarget.httpBaseUrl,
    })
    const bearerSession = await bootstrapRemoteBearerSession({
      httpBaseUrl: resolvedTarget.httpBaseUrl,
      credential: resolvedTarget.credential,
    })

    const nextConnection = createRemoteEnvironmentConnection({
      bearerToken: bearerSession.sessionToken,
      environmentId: descriptor.environmentId,
      httpBaseUrl: resolvedTarget.httpBaseUrl,
      label: input.label?.trim() || descriptor.label,
      wsBaseUrl: resolvedTarget.wsBaseUrl,
    })
    logRuntime('connect-remote-environment', {
      source,
      connectionId: nextConnection.connectionId,
      environmentId: nextConnection.environmentId,
      httpBaseUrl: nextConnection.httpBaseUrl,
      wsBaseUrl: nextConnection.wsBaseUrl,
    })
    await switchActiveConnection(nextConnection, source)
    updateSnapshot('connected', nextConnection, null)
    logRuntime('connect-remote-done', {
      source,
      runtimeGeneration,
      activeConnectionId: nextConnection.connectionId,
      activeEnvironmentId: nextConnection.environmentId,
    })
    return nextConnection
  } catch (error) {
    logRuntimeError('connect-remote-error', {
      source,
      runtimeGeneration,
      activeConnectionId: activeConnection?.connectionId ?? null,
      activeEnvironmentId: activeConnection?.environmentId ?? null,
      error,
    })
    updateSnapshot(
      'error',
      activeConnection,
      error instanceof Error ? error.message : 'Unable to connect to the remote environment.'
    )
    throw error
  }
}

export async function reconnectActiveEnvironment(): Promise<void> {
  const connection = activeConnection
  if (!connection) {
    await initializePrimaryEnvironmentRuntime('reconnect-no-active-primary')
    return
  }

  logRuntime('reconnect-active-start', {
    runtimeGeneration,
    activeConnectionId: connection.connectionId,
    activeEnvironmentId: connection.environmentId,
  })
  updateSnapshot('reconnecting', connection, null)
  try {
    await connection.client.reconnect()
    logRuntime('reconnect-active-done', {
      runtimeGeneration,
      activeConnectionId: connection.connectionId,
      activeEnvironmentId: connection.environmentId,
    })
    updateSnapshot('connected', connection, null)
  } catch (error) {
    logRuntimeError('reconnect-active-error', {
      runtimeGeneration,
      activeConnectionId: connection.connectionId,
      activeEnvironmentId: connection.environmentId,
      error,
    })
    updateSnapshot(
      'error',
      connection,
      error instanceof Error ? error.message : 'Unable to reconnect to the active environment.'
    )
    throw error
  }
}

export async function resetEnvironmentRuntimeForTests(): Promise<void> {
  await disposeConnection(primaryConnection)
  if (activeConnection !== primaryConnection) {
    await disposeConnection(activeConnection)
  }
  primaryConnection = null
  activateConnection(null, 'reset-tests')
  updateSnapshot('idle', null, null)
}
