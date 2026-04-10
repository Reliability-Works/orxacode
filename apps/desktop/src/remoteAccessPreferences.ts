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
    return {
      enabled: persisted.enabled,
    }
  }

  function set(input: Partial<DesktopRemoteAccessPreferences>): DesktopRemoteAccessPreferences {
    const persisted = readPersisted()
    const next: PersistedRemoteAccessPreferences = {
      ...persisted,
      enabled:
        input.enabled === undefined
          ? persisted.enabled
          : sanitizeRemoteAccessEnabled(input.enabled),
    }
    writePersisted(next)
    return { enabled: next.enabled }
  }

  return { get, set }
}
