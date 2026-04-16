import { fetchRemoteMobileSyncBootstrap } from '../environments/remote'
import {
  getActiveEnvironmentConnection,
  getActiveEnvironmentConnectionOrNull,
  getEnvironmentRuntimeDebugState,
  initializePrimaryEnvironmentRuntime,
  initializeSavedRemoteEnvironmentRuntime,
} from '../environments/runtime'
import {
  readSavedEnvironmentSecret,
  resolveActiveSavedEnvironmentRecord,
} from '../environments/runtime/catalog'
import { peekPairingTokenFromUrl } from '../environments/primary'
import { setServerConfigSnapshot } from '../rpc/serverState'
import { useStore } from '../store'
import { resolveRootRuntimeBootStrategy } from './rootRuntimeBootStrategy'

type AuthStatus = 'authenticated' | 'requires-auth'

function hasSavedRemoteCredential(): boolean {
  const savedEnvironment = resolveActiveSavedEnvironmentRecord()
  if (!savedEnvironment) {
    return false
  }
  return Boolean(readSavedEnvironmentSecret(savedEnvironment.environmentId))
}

async function bootstrapSavedRemoteConnection() {
  const connection = getActiveEnvironmentConnection()
  if (connection.kind !== 'saved' || !connection.bearerToken) {
    return
  }

  const { config, readModel } = await fetchRemoteMobileSyncBootstrap({
    httpBaseUrl: connection.httpBaseUrl,
    bearerToken: connection.bearerToken,
  })
  setServerConfigSnapshot(config)
  useStore.getState().syncServerReadModel(readModel, connection.environmentId)
}

export async function runRootRuntimeBoot(authStatus: AuthStatus): Promise<'ready' | 'pair'> {
  if (getActiveEnvironmentConnectionOrNull()) {
    console.info('[mobile-sync] root boot ready', {
      revision: 'mobile-reopen-probe-1',
      runtime: getEnvironmentRuntimeDebugState(),
    })
    return 'ready'
  }

  const strategy = resolveRootRuntimeBootStrategy({
    authStatus,
    hasDesktopManagedPrimary: Boolean(window.desktopBridge?.getLocalEnvironmentBootstrap),
    hasPairingToken: Boolean(peekPairingTokenFromUrl()),
    hasSavedRemote: hasSavedRemoteCredential(),
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

  if (strategy === 'pair') {
    return 'pair'
  }

  if (strategy === 'primary') {
    await initializePrimaryEnvironmentRuntime('root-boot-primary')
  } else {
    await initializeSavedRemoteEnvironmentRuntime('root-boot-saved-remote')
    await bootstrapSavedRemoteConnection()
  }

  console.info('[mobile-sync] root boot ready', {
    revision: 'mobile-reopen-probe-1',
    runtime: getEnvironmentRuntimeDebugState(),
  })
  return 'ready'
}
