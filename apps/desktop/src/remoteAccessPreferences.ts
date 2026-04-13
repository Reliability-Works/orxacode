import * as Crypto from 'node:crypto'
import * as FS from 'node:fs'
import * as Path from 'node:path'

import type { DesktopRemoteAccessPreferences } from '@orxa-code/contracts'

const DEFAULT_REMOTE_ACCESS_PREFERENCES: DesktopRemoteAccessPreferences = {
  enabled: false,
}

interface PersistedRemoteAccessPreferences extends DesktopRemoteAccessPreferences {
  version: 1
}

export interface DesktopRemoteAccessPreferencesStore {
  get(): DesktopRemoteAccessPreferences
  set(input: Partial<DesktopRemoteAccessPreferences>): DesktopRemoteAccessPreferences
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
  }
}

export function createDesktopRemoteAccessPreferencesStore(
  filePath: string
): DesktopRemoteAccessPreferencesStore {
  function readPersisted(): PersistedRemoteAccessPreferences {
    try {
      const raw = FS.readFileSync(filePath, 'utf-8')
      return sanitizePersistedRemoteAccessPreferences(JSON.parse(raw))
    } catch {
      return createPersistedDefaults()
    }
  }

  function writePersisted(next: PersistedRemoteAccessPreferences): void {
    FS.mkdirSync(Path.dirname(filePath), { recursive: true })
    FS.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
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
    } satisfies PersistedRemoteAccessPreferences
    writePersisted(next)
    return toPublicPreferences(next)
  }

  return { get, set }
}
