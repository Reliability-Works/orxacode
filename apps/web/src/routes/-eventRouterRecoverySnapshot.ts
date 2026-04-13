import type { readNativeApi } from '../nativeApi'
import { reconcileSnapshotDerivedState } from './-eventRouterSnapshotState'
import { logSyncReady } from './-eventRouterRecoveryTelemetry'
import type { RuntimeSyncOptions } from './-eventRouterRuntimeSync'

type NativeApi = NonNullable<ReturnType<typeof readNativeApi>>

type RecoverySnapshot = Awaited<ReturnType<NativeApi['orchestration']['getSnapshot']>>

type SnapshotSyncParams = Pick<
  RuntimeSyncOptions,
  'activeEnvironmentId' | 'removeOrphanedTerminalStates' | 'syncProjects' | 'syncServerReadModel' | 'syncThreads'
>

export function applySnapshotReadModel({
  activeEnvironmentId,
  removeOrphanedTerminalStates,
  snapshot,
  syncProjects,
  syncServerReadModel,
  syncThreads,
}: SnapshotSyncParams & {
  snapshot: RecoverySnapshot
}) {
  syncServerReadModel(snapshot, activeEnvironmentId)
  reconcileSnapshotDerivedState(removeOrphanedTerminalStates, syncProjects, syncThreads)
}

export function applyForegroundReconcileSnapshot(
  input: SnapshotSyncParams & {
    log: (event: string, data: Record<string, unknown>) => void
    logData: Record<string, unknown>
    snapshot: RecoverySnapshot
  }
) {
  input.log('reconcile apply start', {
    ...input.logData,
    snapshotSequence: input.snapshot.snapshotSequence,
  })
  applySnapshotReadModel({
    activeEnvironmentId: input.activeEnvironmentId,
    removeOrphanedTerminalStates: input.removeOrphanedTerminalStates,
    snapshot: input.snapshot,
    syncProjects: input.syncProjects,
    syncServerReadModel: input.syncServerReadModel,
    syncThreads: input.syncThreads,
  })
  input.log('reconcile apply done', {
    ...input.logData,
    snapshotSequence: input.snapshot.snapshotSequence,
  })
}

export async function completeSnapshotRecovery(
  input: SnapshotSyncParams & {
    isDisposed: () => boolean
    logData: Record<string, unknown>
    logInfo: (event: string, data: Record<string, unknown>) => void
    logWarn: (event: string, data: Record<string, unknown>) => void
    recoverFromSequenceGap: (reason: 'sequence-gap') => Promise<void>
    snapshot: RecoverySnapshot
    completeSnapshotRecoveryState: (snapshotSequence: number) => boolean
  }
) {
  if (input.isDisposed()) {
    input.logWarn('snapshot recovery aborted disposed', input.logData)
    return
  }

  input.logInfo('snapshot recovery apply start', {
    ...input.logData,
    snapshotSequence: input.snapshot.snapshotSequence,
  })
  applySnapshotReadModel({
    activeEnvironmentId: input.activeEnvironmentId,
    removeOrphanedTerminalStates: input.removeOrphanedTerminalStates,
    snapshot: input.snapshot,
    syncProjects: input.syncProjects,
    syncServerReadModel: input.syncServerReadModel,
    syncThreads: input.syncThreads,
  })
  input.logInfo('snapshot recovery apply done', {
    ...input.logData,
    snapshotSequence: input.snapshot.snapshotSequence,
  })
  logSyncReady(input.logInfo, {
    logData: input.logData,
    snapshot: input.snapshot,
    stage: 'snapshot-recovery',
  })
  if (input.completeSnapshotRecoveryState(input.snapshot.snapshotSequence)) {
    await input.recoverFromSequenceGap('sequence-gap')
  }
}
