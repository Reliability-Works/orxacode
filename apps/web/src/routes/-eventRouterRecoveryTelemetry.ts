type SnapshotWithDeletionState = {
  readonly snapshotSequence: number
  readonly projects: ReadonlyArray<{ readonly deletedAt: string | null }>
  readonly threads: ReadonlyArray<{ readonly deletedAt: string | null }>
}

function countVisibleSnapshotItems(snapshot: SnapshotWithDeletionState) {
  return {
    projects: snapshot.projects.filter(project => project.deletedAt === null).length,
    threads: snapshot.threads.filter(thread => thread.deletedAt === null).length,
  }
}

export function logSyncReady(
  log: (event: string, data: Record<string, unknown>) => void,
  input: {
    readonly logData: Record<string, unknown>
    readonly snapshot: SnapshotWithDeletionState
    readonly stage: 'foreground-reconcile' | 'snapshot-recovery'
  }
) {
  log('sync ready', {
    ...input.logData,
    stage: input.stage,
    snapshotSequence: input.snapshot.snapshotSequence,
    ...countVisibleSnapshotItems(input.snapshot),
  })
}

export function logResolvedReconcile(
  log: (event: string, data: Record<string, unknown>) => void,
  input: {
    readonly logData: Record<string, unknown>
    readonly disposed: boolean
    readonly hasConfig: boolean
    readonly snapshot:
      | {
          readonly snapshotSequence: number
          readonly projects: ReadonlyArray<unknown>
          readonly threads: ReadonlyArray<unknown>
        }
      | null
  }
) {
  log('reconcile resolved', {
    ...input.logData,
    disposed: input.disposed,
    hasConfig: input.hasConfig,
    snapshotSequence: input.snapshot?.snapshotSequence ?? null,
    projects: input.snapshot?.projects.length ?? null,
    threads: input.snapshot?.threads.length ?? null,
  })
}
