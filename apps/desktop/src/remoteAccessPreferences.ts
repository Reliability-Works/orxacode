import * as Crypto from 'node:crypto'

import type { DesktopRemoteAccessPreferences } from '@orxa-code/contracts'

import { readPersistedJsonFile, writePersistedJsonFile } from './persistedJsonFile'

const DEFAULT_REMOTE_ACCESS_PREFERENCES: DesktopRemoteAccessPreferences = {
  enabled: false,
}

interface PersistedRemoteAccessPreferences extends DesktopRemoteAccessPreferences {
  version: 1
  bootstrapToken?: string
}

export interface DesktopRemoteAccessPreferencesStore {
  get(): DesktopRemoteAccessPreferences
  set(input: Partial<DesktopRemoteAccessPreferences>): DesktopRemoteAccessPreferences
  getBootstrapToken(): string | undefined
  setBootstrapToken(token: string | undefined): void
}

export function sanitizeRemoteAccessEnabled(value: unknown): boolean {
  return value === true
}

function createPersistedDefaults(): PersistedRemoteAccessPreferences {
  return {
    ...DEFAULT_REMOTE_ACCESS_PREFERENCES,
    version: 1,
  }
}

function toPublicPreferences(
  input: Pick<PersistedRemoteAccessPreferences, 'enabled' | 'environmentId'>
): DesktopRemoteAccessPreferences {
  return {
    enabled: input.enabled,
    ...(input.environmentId ? { environmentId: input.environmentId } : {}),
  }
}

function createRemoteAccessEnvironmentId(): string {
  return Crypto.randomUUID()
}

function sanitizePersistedRemoteAccessPreferences(raw: unknown): PersistedRemoteAccessPreferences {
  const defaults = createPersistedDefaults()
  if (!raw || typeof raw !== 'object') {
    return defaults
  }

  const next = raw as Partial<PersistedRemoteAccessPreferences>
  return {
    version: 1,
    enabled:
      next.enabled === undefined ? defaults.enabled : sanitizeRemoteAccessEnabled(next.enabled),
    ...(typeof next.environmentId === 'string' && next.environmentId.length > 0
      ? { environmentId: next.environmentId }
      : {}),
    ...(typeof next.bootstrapToken === 'string' && next.bootstrapToken.length > 0
      ? { bootstrapToken: next.bootstrapToken }
      : {}),
  }
}

export function createDesktopRemoteAccessPreferencesStore(
  filePath: string
): DesktopRemoteAccessPreferencesStore {
  function readPersisted(): PersistedRemoteAccessPreferences {
    return readPersistedJsonFile({
      filePath,
      fallback: createPersistedDefaults,
      sanitize: sanitizePersistedRemoteAccessPreferences,
    })
  }

  function writePersisted(next: PersistedRemoteAccessPreferences): void {
    writePersistedJsonFile(filePath, next)
  }

  function get(): DesktopRemoteAccessPreferences {
    const persisted = readPersisted()
    const next = {
      version: persisted.version,
      enabled: persisted.enabled,
      environmentId: persisted.environmentId ?? createRemoteAccessEnvironmentId(),
    } satisfies PersistedRemoteAccessPreferences
    if (next.environmentId !== persisted.environmentId) {
      writePersisted(next)
    }
    return toPublicPreferences(next)
  }

  function set(input: Partial<DesktopRemoteAccessPreferences>): DesktopRemoteAccessPreferences {
    const persisted = readPersisted()
    const enabled =
      input.enabled === undefined ? persisted.enabled : sanitizeRemoteAccessEnabled(input.enabled)
    const environmentId =
      input.environmentId ?? persisted.environmentId ?? createRemoteAccessEnvironmentId()
    const next = {
      version: persisted.version,
      enabled,
      environmentId,
      ...(enabled && persisted.bootstrapToken ? { bootstrapToken: persisted.bootstrapToken } : {}),
    } satisfies PersistedRemoteAccessPreferences
    writePersisted(next)
    return toPublicPreferences(next)
  }

  function getBootstrapToken(): string | undefined {
    return readPersisted().bootstrapToken
  }

  function setBootstrapToken(token: string | undefined): void {
    const persisted = readPersisted()
    const next: PersistedRemoteAccessPreferences = {
      ...persisted,
      ...(token ? { bootstrapToken: token } : {}),
    }
    if (!token) {
      delete next.bootstrapToken
    }
    writePersisted(next)
  }

  return { get, set, getBootstrapToken, setBootstrapToken }
}
