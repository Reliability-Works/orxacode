import * as FS from 'node:fs'
import * as Path from 'node:path'

import type { DesktopUpdatePreferences, DesktopUpdateReleaseChannel } from '@orxa-code/contracts'

const DEFAULT_UPDATE_PREFERENCES: DesktopUpdatePreferences = {
  releaseChannel: 'stable',
}

interface PersistedUpdatePreferences extends DesktopUpdatePreferences {
  version: 1
  lastInstalledVersion: string | null
}

export interface DesktopUpdatePreferencesStore {
  get(): DesktopUpdatePreferences
  set(input: Partial<DesktopUpdatePreferences>): DesktopUpdatePreferences
  syncInstalledVersion(appVersion: string): DesktopUpdatePreferences
}

export function sanitizeReleaseChannel(value: unknown): DesktopUpdateReleaseChannel {
  return value === 'prerelease' ? 'prerelease' : 'stable'
}

export function resolveDesktopUpdateFeedChannel(
  releaseChannel: DesktopUpdateReleaseChannel
): 'latest' | 'beta' {
  return releaseChannel === 'prerelease' ? 'beta' : 'latest'
}

export function isPrereleaseVersion(value: string): boolean {
  return /-[0-9A-Za-z]/.test(value)
}

function createPersistedDefaults(): PersistedUpdatePreferences {
  return {
    ...DEFAULT_UPDATE_PREFERENCES,
    version: 1,
    lastInstalledVersion: null,
  }
}

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sanitizePersistedUpdatePreferences(raw: unknown): PersistedUpdatePreferences {
  const defaults = createPersistedDefaults()
  if (!raw || typeof raw !== 'object') return defaults
  const next = raw as Partial<PersistedUpdatePreferences>
  return {
    version: 1,
    releaseChannel: sanitizeReleaseChannel(next.releaseChannel),
    lastInstalledVersion: normalizeVersion(next.lastInstalledVersion),
  }
}

export function createDesktopUpdatePreferencesStore(
  filePath: string
): DesktopUpdatePreferencesStore {
  function readPersisted(): PersistedUpdatePreferences {
    try {
      const raw = FS.readFileSync(filePath, 'utf-8')
      return sanitizePersistedUpdatePreferences(JSON.parse(raw))
    } catch {
      return createPersistedDefaults()
    }
  }

  function writePersisted(next: PersistedUpdatePreferences): void {
    FS.mkdirSync(Path.dirname(filePath), { recursive: true })
    FS.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
  }

  function get(): DesktopUpdatePreferences {
    const persisted = readPersisted()
    return {
      releaseChannel: persisted.releaseChannel,
    }
  }

  function set(input: Partial<DesktopUpdatePreferences>): DesktopUpdatePreferences {
    const persisted = readPersisted()
    const next: PersistedUpdatePreferences = {
      ...persisted,
      releaseChannel:
        input.releaseChannel === undefined
          ? persisted.releaseChannel
          : sanitizeReleaseChannel(input.releaseChannel),
    }
    writePersisted(next)
    return { releaseChannel: next.releaseChannel }
  }

  function syncInstalledVersion(appVersion: string): DesktopUpdatePreferences {
    const persisted = readPersisted()
    const normalizedVersion = normalizeVersion(appVersion)
    if (!normalizedVersion) {
      return { releaseChannel: persisted.releaseChannel }
    }

    const shouldAutoSelectPrerelease =
      isPrereleaseVersion(normalizedVersion) &&
      persisted.lastInstalledVersion !== normalizedVersion &&
      persisted.releaseChannel !== 'prerelease'

    const next: PersistedUpdatePreferences = {
      ...persisted,
      lastInstalledVersion: normalizedVersion,
      releaseChannel: shouldAutoSelectPrerelease ? 'prerelease' : persisted.releaseChannel,
    }
    writePersisted(next)
    return { releaseChannel: next.releaseChannel }
  }

  return { get, set, syncInstalledVersion }
}
