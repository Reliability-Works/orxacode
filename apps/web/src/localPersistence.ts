import type { SavedEnvironmentRecord } from './environments/runtime/catalog'

const SAVED_ENVIRONMENTS_STORAGE_KEY = 'orxa:saved-environments:v2'
const ACTIVE_SAVED_ENVIRONMENT_ID_STORAGE_KEY = 'orxa:active-saved-environment-id:v2'
const SAVED_ENVIRONMENT_BEARER_PREFIX = 'orxa:saved-environment-bearer:v1:'

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function bearerStorageKey(environmentId: string): string {
  return `${SAVED_ENVIRONMENT_BEARER_PREFIX}${environmentId}`
}

export const localPersistence = {
  canUseStorage,
  getSavedEnvironmentRegistry(): SavedEnvironmentRecord[] {
    if (!canUseStorage()) {
      return []
    }
    try {
      const raw = window.localStorage.getItem(SAVED_ENVIRONMENTS_STORAGE_KEY)
      if (!raw) {
        return []
      }
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? (parsed as SavedEnvironmentRecord[]) : []
    } catch {
      return []
    }
  },
  setSavedEnvironmentRegistry(records: ReadonlyArray<SavedEnvironmentRecord>): void {
    if (!canUseStorage()) {
      return
    }
    window.localStorage.setItem(SAVED_ENVIRONMENTS_STORAGE_KEY, JSON.stringify(records))
  },
  getActiveSavedEnvironmentId(): string | null {
    if (!canUseStorage()) {
      return null
    }
    return window.localStorage.getItem(ACTIVE_SAVED_ENVIRONMENT_ID_STORAGE_KEY)
  },
  setActiveSavedEnvironmentId(environmentId: string | null): void {
    if (!canUseStorage()) {
      return
    }
    if (!environmentId) {
      window.localStorage.removeItem(ACTIVE_SAVED_ENVIRONMENT_ID_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(ACTIVE_SAVED_ENVIRONMENT_ID_STORAGE_KEY, environmentId)
  },
  getSavedEnvironmentSecret(environmentId: string): string | null {
    if (!canUseStorage()) {
      return null
    }
    return window.localStorage.getItem(bearerStorageKey(environmentId))
  },
  setSavedEnvironmentSecret(environmentId: string, bearerToken: string): boolean {
    if (!canUseStorage()) {
      return false
    }
    window.localStorage.setItem(bearerStorageKey(environmentId), bearerToken)
    return true
  },
  removeSavedEnvironmentSecret(environmentId: string): void {
    if (!canUseStorage()) {
      return
    }
    window.localStorage.removeItem(bearerStorageKey(environmentId))
  },
  clearSavedEnvironmentState(): void {
    if (!canUseStorage()) {
      return
    }
    const keysToRemove: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(SAVED_ENVIRONMENT_BEARER_PREFIX)) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key)
    }
    window.localStorage.removeItem(SAVED_ENVIRONMENTS_STORAGE_KEY)
    window.localStorage.removeItem(ACTIVE_SAVED_ENVIRONMENT_ID_STORAGE_KEY)
  },
}
