import type { ActiveEnvironmentConnection } from './connection'
import {
  markSavedEnvironmentConnected,
  readSavedEnvironmentSecret,
  removeSavedEnvironmentRecord,
  removeSavedEnvironmentSecret,
  resolveActiveSavedEnvironmentRecord,
  setStoredActiveSavedEnvironmentId,
  upsertSavedEnvironmentRecord,
  writeSavedEnvironmentSecret,
} from './catalog'

export class SavedRemoteEnvironmentReauthRequiredError extends Error {
  constructor(message = 'Saved remote session expired. Pair this device again.') {
    super(message)
    this.name = 'SavedRemoteEnvironmentReauthRequiredError'
  }
}

export function persistSavedRemoteEnvironment(input: {
  readonly connection: ActiveEnvironmentConnection
  readonly secret: string
  readonly createdAt?: string | undefined
}) {
  const connectedAt = new Date().toISOString()
  upsertSavedEnvironmentRecord({
    environmentId: input.connection.environmentId,
    label: input.connection.label,
    httpBaseUrl: input.connection.httpBaseUrl,
    wsBaseUrl: input.connection.wsBaseUrl,
    createdAt: input.createdAt ?? connectedAt,
    lastConnectedAt: connectedAt,
  })
  writeSavedEnvironmentSecret(input.connection.environmentId, input.secret)
  markSavedEnvironmentConnected(input.connection.environmentId, connectedAt)
  setStoredActiveSavedEnvironmentId(input.connection.environmentId)
}

export function clearSavedRemoteEnvironment(input: { readonly environmentId: string }) {
  removeSavedEnvironmentSecret(input.environmentId)
  removeSavedEnvironmentRecord(input.environmentId)
  const activeSavedEnvironment = resolveActiveSavedEnvironmentRecord()
  setStoredActiveSavedEnvironmentId(activeSavedEnvironment?.environmentId ?? null)
}

export function readActiveSavedRemoteCredential() {
  const savedEnvironment = resolveActiveSavedEnvironmentRecord()
  if (!savedEnvironment) {
    return null
  }
  const savedSecret = readSavedEnvironmentSecret(savedEnvironment.environmentId)
  if (!savedSecret) {
    clearSavedRemoteEnvironment({ environmentId: savedEnvironment.environmentId })
    return null
  }

  return {
    savedEnvironment,
    savedSecret,
  }
}
