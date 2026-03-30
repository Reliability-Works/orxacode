export type WorkspaceSessionMetadataMap<T> = Record<string, T>

export type WorkspaceSessionReference = {
  directory: string
  sessionID: string
}

export function buildWorkspaceSessionMetadataKey(directory: string, sessionID: string) {
  return `${directory}::${sessionID}`
}

export function readWorkspaceSessionMetadata<T>(
  map: WorkspaceSessionMetadataMap<T>,
  directory?: string | null,
  sessionID?: string | null
) {
  if (!directory || !sessionID) {
    return undefined
  }
  return map[buildWorkspaceSessionMetadataKey(directory, sessionID)]
}

export function migrateLegacySessionMetadata<T>(
  legacyMap: Record<string, T>,
  currentMap: WorkspaceSessionMetadataMap<T>,
  sessions: WorkspaceSessionReference[]
) {
  let changed = false
  const nextMap = { ...currentMap }

  for (const session of sessions) {
    const legacyValue = legacyMap[session.sessionID]
    if (legacyValue === undefined) {
      continue
    }

    const nextKey = buildWorkspaceSessionMetadataKey(session.directory, session.sessionID)
    if (nextMap[nextKey] !== undefined) {
      continue
    }

    nextMap[nextKey] = legacyValue
    changed = true
  }

  return changed ? nextMap : currentMap
}
