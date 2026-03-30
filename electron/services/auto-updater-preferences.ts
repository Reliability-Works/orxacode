import Store from 'electron-store'
import type { UpdatePreferences, UpdateReleaseChannel } from '../../shared/ipc'

const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = {
  autoCheckEnabled: true,
  releaseChannel: 'stable',
}

type PersistedUpdaterPreferences = UpdatePreferences & {
  version: 1
  lastInstalledVersion?: string | null
}

export type UpdatePreferencesStore = {
  get: () => UpdatePreferences
  set: (input: Partial<UpdatePreferences>) => UpdatePreferences
  syncInstalledVersion?: (appVersion: string) => UpdatePreferences
}

export function sanitizeReleaseChannel(value: unknown): UpdateReleaseChannel {
  return value === 'prerelease' ? 'prerelease' : 'stable'
}

export function isPrereleaseVersion(value: string): boolean {
  return /-[0-9A-Za-z]/.test(value)
}

export class ElectronUpdatePreferencesStore implements UpdatePreferencesStore {
  private readonly store = new Store<PersistedUpdaterPreferences>({
    name: 'update-preferences',
    defaults: {
      ...DEFAULT_UPDATE_PREFERENCES,
      version: 1,
      lastInstalledVersion: null,
    },
  })

  get(): UpdatePreferences {
    return {
      autoCheckEnabled: this.store.get('autoCheckEnabled'),
      releaseChannel: sanitizeReleaseChannel(this.store.get('releaseChannel')),
    }
  }

  set(input: Partial<UpdatePreferences>): UpdatePreferences {
    const nextAutoCheckEnabled =
      typeof input.autoCheckEnabled === 'boolean'
        ? input.autoCheckEnabled
        : this.store.get('autoCheckEnabled', DEFAULT_UPDATE_PREFERENCES.autoCheckEnabled)
    const nextReleaseChannel =
      input.releaseChannel !== undefined
        ? sanitizeReleaseChannel(input.releaseChannel)
        : sanitizeReleaseChannel(
            this.store.get('releaseChannel', DEFAULT_UPDATE_PREFERENCES.releaseChannel)
          )

    this.store.set('autoCheckEnabled', nextAutoCheckEnabled)
    this.store.set('releaseChannel', nextReleaseChannel)

    return {
      autoCheckEnabled: nextAutoCheckEnabled,
      releaseChannel: nextReleaseChannel,
    }
  }

  syncInstalledVersion(appVersion: string): UpdatePreferences {
    const normalizedVersion = appVersion.trim()
    const lastInstalledVersion = this.store.get('lastInstalledVersion')
    const normalizedLastInstalledVersion =
      typeof lastInstalledVersion === 'string' && lastInstalledVersion.trim().length > 0
        ? lastInstalledVersion.trim()
        : null

    const currentPreferences = this.get()
    const shouldAutoSelectPrerelease =
      isPrereleaseVersion(normalizedVersion) &&
      normalizedLastInstalledVersion !== normalizedVersion &&
      currentPreferences.releaseChannel !== 'prerelease'

    this.store.set('lastInstalledVersion', normalizedVersion)
    if (!shouldAutoSelectPrerelease) {
      return currentPreferences
    }

    return this.set({ releaseChannel: 'prerelease' })
  }
}
