import { createPersistedSessionStore } from './persisted-session-storage'

export type PersistedOpencodeReplayCheckpoint = {
  cursor: number
  sessionCursors: Record<string, number>
}

const persistedReplayCheckpoints = createPersistedSessionStore<PersistedOpencodeReplayCheckpoint>({
  storagePrefix: 'orxa:opencodeReplayCheckpoint:v1',
  createDefault: () => ({ cursor: 0, sessionCursors: {} }),
  hydrate: value => ({
    cursor:
      typeof value?.cursor === 'number' && Number.isFinite(value.cursor) && value.cursor > 0
        ? Math.floor(value.cursor)
        : 0,
    sessionCursors:
      value?.sessionCursors && typeof value.sessionCursors === 'object'
        ? Object.fromEntries(
            Object.entries(value.sessionCursors).filter(
              (entry): entry is [string, number] =>
                typeof entry[0] === 'string' &&
                typeof entry[1] === 'number' &&
                Number.isFinite(entry[1]) &&
                entry[1] > 0
            )
          )
        : {},
  }),
})

export function getPersistedOpencodeReplayCheckpoint(
  directory: string
): PersistedOpencodeReplayCheckpoint {
  return persistedReplayCheckpoints.get(directory)
}

export function setPersistedOpencodeReplayCheckpoint(
  directory: string,
  checkpoint: PersistedOpencodeReplayCheckpoint
) {
  persistedReplayCheckpoints.set(directory, checkpoint)
}

export function resetPersistedOpencodeReplayCheckpointsForTests() {
  persistedReplayCheckpoints.resetForTests()
}
