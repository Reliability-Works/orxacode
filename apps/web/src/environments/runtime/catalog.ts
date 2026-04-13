import { create } from 'zustand'

import { localPersistence } from '../../localPersistence'

export interface SavedEnvironmentRecord {
  readonly environmentId: string
  readonly label: string
  readonly httpBaseUrl: string
  readonly wsBaseUrl: string
  readonly createdAt: string
  readonly lastConnectedAt: string | null
}

interface SavedEnvironmentRegistryStoreState {
  readonly byId: Record<string, SavedEnvironmentRecord>
  readonly upsert: (record: SavedEnvironmentRecord) => void
  readonly remove: (environmentId: string) => void
  readonly markConnected: (environmentId: string, connectedAt: string) => void
  readonly reset: () => void
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function sanitizeSavedEnvironmentRecord(raw: unknown): SavedEnvironmentRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const next = raw as Partial<SavedEnvironmentRecord>
  if (
    !isNonEmptyString(next.environmentId) ||
    !isNonEmptyString(next.label) ||
    !isNonEmptyString(next.httpBaseUrl) ||
    !isNonEmptyString(next.wsBaseUrl) ||
    !isNonEmptyString(next.createdAt)
  ) {
    return null
  }

  return {
    environmentId: next.environmentId,
    label: next.label,
    httpBaseUrl: next.httpBaseUrl,
    wsBaseUrl: next.wsBaseUrl,
    createdAt: next.createdAt,
    lastConnectedAt: isNonEmptyString(next.lastConnectedAt) ? next.lastConnectedAt : null,
  }
}

function readPersistedSavedEnvironmentRecords(): SavedEnvironmentRecord[] {
  return localPersistence
    .getSavedEnvironmentRegistry()
    .map(sanitizeSavedEnvironmentRecord)
    .filter((value): value is SavedEnvironmentRecord => value !== null)
}

function writePersistedSavedEnvironmentRecords(records: ReadonlyArray<SavedEnvironmentRecord>): void {
  localPersistence.setSavedEnvironmentRegistry(records)
}

function persistSavedEnvironmentRegistryState(byId: Record<string, SavedEnvironmentRecord>): void {
  writePersistedSavedEnvironmentRecords(Object.values(byId))
}

const initialSavedEnvironmentRecords = Object.fromEntries(
  readPersistedSavedEnvironmentRecords().map(record => [record.environmentId, record])
) as Record<string, SavedEnvironmentRecord>

export const useSavedEnvironmentRegistryStore = create<SavedEnvironmentRegistryStoreState>()(
  set => ({
    byId: initialSavedEnvironmentRecords,
    upsert: record =>
      set(state => {
        const byId = {
          ...state.byId,
          [record.environmentId]: record,
        }
        persistSavedEnvironmentRegistryState(byId)
        return { byId }
      }),
    remove: environmentId =>
      set(state => {
        const remaining = { ...state.byId }
        delete remaining[environmentId]
        persistSavedEnvironmentRegistryState(remaining)
        return { byId: remaining }
      }),
    markConnected: (environmentId, connectedAt) =>
      set(state => {
        const existing = state.byId[environmentId]
        if (!existing) {
          return state
        }
        const byId = {
          ...state.byId,
          [environmentId]: {
            ...existing,
            lastConnectedAt: connectedAt,
          },
        }
        persistSavedEnvironmentRegistryState(byId)
        return { byId }
      }),
    reset: () => {
      persistSavedEnvironmentRegistryState({})
      set({ byId: {} })
    },
  })
)

export function listSavedEnvironmentRecords(): ReadonlyArray<SavedEnvironmentRecord> {
  return Object.values(useSavedEnvironmentRegistryStore.getState().byId).toSorted((left, right) =>
    left.label.localeCompare(right.label)
  )
}

export function getSavedEnvironmentRecord(environmentId: string): SavedEnvironmentRecord | null {
  return useSavedEnvironmentRegistryStore.getState().byId[environmentId] ?? null
}

export function hasSavedEnvironmentRecords(): boolean {
  return listSavedEnvironmentRecords().length > 0
}

export function getStoredActiveSavedEnvironmentId(): string | null {
  const value = localPersistence.getActiveSavedEnvironmentId()
  return isNonEmptyString(value) ? value : null
}

export function setStoredActiveSavedEnvironmentId(environmentId: string | null): void {
  localPersistence.setActiveSavedEnvironmentId(environmentId)
}

export function resolveActiveSavedEnvironmentRecord(): SavedEnvironmentRecord | null {
  const records = listSavedEnvironmentRecords()
  if (records.length === 0) {
    return null
  }
  const activeEnvironmentId = getStoredActiveSavedEnvironmentId()
  if (!activeEnvironmentId) {
    return records[0] ?? null
  }
  return records.find(record => record.environmentId === activeEnvironmentId) ?? records[0] ?? null
}

export function readSavedEnvironmentBearerToken(environmentId: string): string | null {
  const value = localPersistence.getSavedEnvironmentSecret(environmentId)
  return isNonEmptyString(value) ? value : null
}

export function writeSavedEnvironmentBearerToken(
  environmentId: string,
  bearerToken: string
): boolean {
  return localPersistence.setSavedEnvironmentSecret(environmentId, bearerToken)
}

export function removeSavedEnvironmentBearerToken(environmentId: string): void {
  localPersistence.removeSavedEnvironmentSecret(environmentId)
}

export function resetSavedEnvironmentRegistryForTests(): void {
  useSavedEnvironmentRegistryStore.getState().reset()
  localPersistence.clearSavedEnvironmentState()
}
