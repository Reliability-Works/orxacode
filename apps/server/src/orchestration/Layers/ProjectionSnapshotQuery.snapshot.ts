import { Effect } from 'effect'

import type {
  OrchestrationCheckpointSummary,
  OrchestrationLatestTurn,
  OrchestrationMessage,
  OrchestrationProject,
  OrchestrationProposedPlan,
  OrchestrationReadModel,
  OrchestrationSession,
  OrchestrationThread,
  OrchestrationThreadActivity,
} from '@orxa-code/contracts'

import type { ProjectionRepositoryError } from '../../persistence/Errors.ts'

export type ProjectionSnapshotProjectRow = {
  projectId: OrchestrationProject['id']
  title: string
  workspaceRoot: string
  defaultModelSelection: OrchestrationProject['defaultModelSelection']
  scripts: OrchestrationProject['scripts']
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type ProjectionSnapshotThreadRow = {
  threadId: OrchestrationThread['id']
  projectId: OrchestrationThread['projectId']
  title: string
  modelSelection: OrchestrationThread['modelSelection']
  runtimeMode: OrchestrationThread['runtimeMode']
  interactionMode: OrchestrationThread['interactionMode']
  branch: string | null
  worktreePath: string | null
  handoff: OrchestrationThread['handoff']
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  deletedAt: string | null
}

export type ProjectionSnapshotMessageRow = {
  messageId: OrchestrationMessage['id']
  threadId: OrchestrationThread['id']
  turnId: OrchestrationMessage['turnId']
  role: OrchestrationMessage['role']
  text: string
  attachments: OrchestrationMessage['attachments'] | null
  isStreaming: number
  createdAt: string
  updatedAt: string
}

export type ProjectionSnapshotProposedPlanRow = {
  planId: OrchestrationProposedPlan['id']
  threadId: OrchestrationThread['id']
  turnId: OrchestrationProposedPlan['turnId']
  planMarkdown: string
  implementedAt: string | null
  implementationThreadId: OrchestrationProposedPlan['implementationThreadId']
  createdAt: string
  updatedAt: string
}

export type ProjectionSnapshotActivityRow = {
  activityId: OrchestrationThreadActivity['id']
  threadId: OrchestrationThread['id']
  turnId: OrchestrationThreadActivity['turnId']
  tone: OrchestrationThreadActivity['tone']
  kind: OrchestrationThreadActivity['kind']
  summary: string
  payload: unknown
  sequence: number | null
  createdAt: string
}

export type ProjectionSnapshotSessionRow = {
  threadId: OrchestrationThread['id']
  status: OrchestrationSession['status']
  providerName: OrchestrationSession['providerName']
  runtimeMode: OrchestrationSession['runtimeMode']
  activeTurnId: OrchestrationSession['activeTurnId']
  lastError: string | null
  updatedAt: string
}

export type ProjectionSnapshotCheckpointRow = {
  threadId: OrchestrationThread['id']
  turnId: OrchestrationCheckpointSummary['turnId']
  checkpointTurnCount: number
  checkpointRef: OrchestrationCheckpointSummary['checkpointRef']
  status: OrchestrationCheckpointSummary['status']
  files: OrchestrationCheckpointSummary['files']
  assistantMessageId: OrchestrationCheckpointSummary['assistantMessageId']
  completedAt: string
}

export type ProjectionSnapshotLatestTurnRow = {
  threadId: OrchestrationThread['id']
  turnId: OrchestrationLatestTurn['turnId']
  state: string
  requestedAt: string
  startedAt: string | null
  completedAt: string | null
  assistantMessageId: OrchestrationLatestTurn['assistantMessageId']
  sourceProposedPlanThreadId: OrchestrationThread['id'] | null
  sourceProposedPlanId: OrchestrationProposedPlan['id'] | null
}

export type ProjectionSnapshotStateRow = {
  projector: string
  lastAppliedSequence: number
  updatedAt: string
}

type ProjectionSnapshotAssemblyState = {
  updatedAt: string | null
  messagesByThread: Map<string, OrchestrationMessage[]>
  proposedPlansByThread: Map<string, OrchestrationProposedPlan[]>
  activitiesByThread: Map<string, OrchestrationThreadActivity[]>
  checkpointsByThread: Map<string, OrchestrationCheckpointSummary[]>
  sessionsByThread: Map<string, OrchestrationSession>
  latestTurnByThread: Map<string, OrchestrationLatestTurn>
}

type ProjectionSnapshotRows = {
  projectRows: ReadonlyArray<ProjectionSnapshotProjectRow>
  threadRows: ReadonlyArray<ProjectionSnapshotThreadRow>
  messageRows: ReadonlyArray<ProjectionSnapshotMessageRow>
  proposedPlanRows: ReadonlyArray<ProjectionSnapshotProposedPlanRow>
  activityRows: ReadonlyArray<ProjectionSnapshotActivityRow>
  sessionRows: ReadonlyArray<ProjectionSnapshotSessionRow>
  checkpointRows: ReadonlyArray<ProjectionSnapshotCheckpointRow>
  latestTurnRows: ReadonlyArray<ProjectionSnapshotLatestTurnRow>
  stateRows: ReadonlyArray<ProjectionSnapshotStateRow>
}

function appendByThread<Value>(
  collection: Map<string, Value[]>,
  threadId: string,
  value: Value
): void {
  const threadValues = collection.get(threadId) ?? []
  threadValues.push(value)
  collection.set(threadId, threadValues)
}

function applyProjectRows(
  state: ProjectionSnapshotAssemblyState,
  rows: ReadonlyArray<ProjectionSnapshotProjectRow>,
  maxIso: (left: string | null, right: string) => string
): void {
  for (const row of rows) {
    state.updatedAt = maxIso(state.updatedAt, row.updatedAt)
  }
}

function applyThreadRows(
  state: ProjectionSnapshotAssemblyState,
  rows: ReadonlyArray<ProjectionSnapshotThreadRow>,
  maxIso: (left: string | null, right: string) => string
): void {
  for (const row of rows) {
    state.updatedAt = maxIso(state.updatedAt, row.updatedAt)
  }
}

function applyStateRows(
  state: ProjectionSnapshotAssemblyState,
  rows: ReadonlyArray<ProjectionSnapshotStateRow>,
  maxIso: (left: string | null, right: string) => string
): void {
  for (const row of rows) {
    state.updatedAt = maxIso(state.updatedAt, row.updatedAt)
  }
}

function applyMessageRows(
  state: ProjectionSnapshotAssemblyState,
  rows: ReadonlyArray<ProjectionSnapshotMessageRow>,
  maxIso: (left: string | null, right: string) => string
): void {
  for (const row of rows) {
    state.updatedAt = maxIso(state.updatedAt, row.updatedAt)
    appendByThread(state.messagesByThread, row.threadId, {
      id: row.messageId,
      role: row.role,
      text: row.text,
      ...(row.attachments !== null ? { attachments: row.attachments } : {}),
      turnId: row.turnId,
      streaming: row.isStreaming === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }
}

function applyProposedPlanRows(
  state: ProjectionSnapshotAssemblyState,
  rows: ReadonlyArray<ProjectionSnapshotProposedPlanRow>,
  maxIso: (left: string | null, right: string) => string
): void {
  for (const row of rows) {
    state.updatedAt = maxIso(state.updatedAt, row.updatedAt)
    appendByThread(state.proposedPlansByThread, row.threadId, {
      id: row.planId,
      turnId: row.turnId,
      planMarkdown: row.planMarkdown,
      implementedAt: row.implementedAt,
      implementationThreadId: row.implementationThreadId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }
}

function applyActivityRows(
  state: ProjectionSnapshotAssemblyState,
  rows: ReadonlyArray<ProjectionSnapshotActivityRow>,
  maxIso: (left: string | null, right: string) => string
): void {
  for (const row of rows) {
    state.updatedAt = maxIso(state.updatedAt, row.createdAt)
    appendByThread(state.activitiesByThread, row.threadId, {
      id: row.activityId,
      tone: row.tone,
      kind: row.kind,
      summary: row.summary,
      payload: row.payload,
      turnId: row.turnId,
      ...(row.sequence !== null ? { sequence: row.sequence } : {}),
      createdAt: row.createdAt,
    })
  }
}

function applyCheckpointRows(
  state: ProjectionSnapshotAssemblyState,
  rows: ReadonlyArray<ProjectionSnapshotCheckpointRow>,
  maxIso: (left: string | null, right: string) => string
): void {
  for (const row of rows) {
    state.updatedAt = maxIso(state.updatedAt, row.completedAt)
    appendByThread(state.checkpointsByThread, row.threadId, {
      turnId: row.turnId,
      checkpointTurnCount: row.checkpointTurnCount,
      checkpointRef: row.checkpointRef,
      status: row.status,
      files: row.files,
      assistantMessageId: row.assistantMessageId,
      completedAt: row.completedAt,
    })
  }
}

function mapLatestTurnState(state: string): OrchestrationLatestTurn['state'] {
  if (state === 'error') {
    return 'error'
  }
  if (state === 'interrupted') {
    return 'interrupted'
  }
  if (state === 'completed') {
    return 'completed'
  }
  return 'running'
}

function applyLatestTurnRows(
  state: ProjectionSnapshotAssemblyState,
  rows: ReadonlyArray<ProjectionSnapshotLatestTurnRow>,
  maxIso: (left: string | null, right: string) => string
): void {
  for (const row of rows) {
    state.updatedAt = maxIso(state.updatedAt, row.requestedAt)
    if (row.startedAt !== null) {
      state.updatedAt = maxIso(state.updatedAt, row.startedAt)
    }
    if (row.completedAt !== null) {
      state.updatedAt = maxIso(state.updatedAt, row.completedAt)
    }
    if (state.latestTurnByThread.has(row.threadId)) {
      continue
    }

    state.latestTurnByThread.set(row.threadId, {
      turnId: row.turnId,
      state: mapLatestTurnState(row.state),
      requestedAt: row.requestedAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      assistantMessageId: row.assistantMessageId,
      ...(row.sourceProposedPlanThreadId !== null && row.sourceProposedPlanId !== null
        ? {
            sourceProposedPlan: {
              threadId: row.sourceProposedPlanThreadId,
              planId: row.sourceProposedPlanId,
            },
          }
        : {}),
    })
  }
}

function applySessionRows(
  state: ProjectionSnapshotAssemblyState,
  rows: ReadonlyArray<ProjectionSnapshotSessionRow>,
  maxIso: (left: string | null, right: string) => string
): void {
  for (const row of rows) {
    state.updatedAt = maxIso(state.updatedAt, row.updatedAt)
    state.sessionsByThread.set(row.threadId, {
      threadId: row.threadId,
      status: row.status,
      providerName: row.providerName,
      runtimeMode: row.runtimeMode,
      activeTurnId: row.activeTurnId,
      lastError: row.lastError,
      updatedAt: row.updatedAt,
    })
  }
}

export function buildOrchestrationProjectFromRow(
  row: ProjectionSnapshotProjectRow
): OrchestrationProject {
  return {
    id: row.projectId,
    title: row.title,
    workspaceRoot: row.workspaceRoot,
    defaultModelSelection: row.defaultModelSelection,
    scripts: row.scripts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}

function buildProjects(
  rows: ReadonlyArray<ProjectionSnapshotProjectRow>
): ReadonlyArray<OrchestrationProject> {
  return rows.map(buildOrchestrationProjectFromRow)
}

function buildThreads(
  rows: ReadonlyArray<ProjectionSnapshotThreadRow>,
  state: ProjectionSnapshotAssemblyState
): ReadonlyArray<OrchestrationThread> {
  return rows.map(row => ({
    id: row.threadId,
    projectId: row.projectId,
    title: row.title,
    modelSelection: row.modelSelection,
    runtimeMode: row.runtimeMode,
    interactionMode: row.interactionMode,
    branch: row.branch,
    worktreePath: row.worktreePath,
    handoff: row.handoff,
    latestTurn: state.latestTurnByThread.get(row.threadId) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    deletedAt: row.deletedAt,
    messages: state.messagesByThread.get(row.threadId) ?? [],
    proposedPlans: state.proposedPlansByThread.get(row.threadId) ?? [],
    activities: state.activitiesByThread.get(row.threadId) ?? [],
    checkpoints: state.checkpointsByThread.get(row.threadId) ?? [],
    session: state.sessionsByThread.get(row.threadId) ?? null,
  }))
}

function createAssemblyState(): ProjectionSnapshotAssemblyState {
  return {
    updatedAt: null,
    messagesByThread: new Map(),
    proposedPlansByThread: new Map(),
    activitiesByThread: new Map(),
    checkpointsByThread: new Map(),
    sessionsByThread: new Map(),
    latestTurnByThread: new Map(),
  }
}

function assembleProjectionSnapshot(
  rows: ProjectionSnapshotRows,
  computeSnapshotSequence: (rows: ReadonlyArray<ProjectionSnapshotStateRow>) => number,
  maxIso: (left: string | null, right: string) => string
): {
  snapshotSequence: number
  projects: ReadonlyArray<OrchestrationProject>
  threads: ReadonlyArray<OrchestrationThread>
  updatedAt: string
} {
  const state = createAssemblyState()

  applyProjectRows(state, rows.projectRows, maxIso)
  applyThreadRows(state, rows.threadRows, maxIso)
  applyStateRows(state, rows.stateRows, maxIso)
  applyMessageRows(state, rows.messageRows, maxIso)
  applyProposedPlanRows(state, rows.proposedPlanRows, maxIso)
  applyActivityRows(state, rows.activityRows, maxIso)
  applyCheckpointRows(state, rows.checkpointRows, maxIso)
  applyLatestTurnRows(state, rows.latestTurnRows, maxIso)
  applySessionRows(state, rows.sessionRows, maxIso)

  return {
    snapshotSequence: computeSnapshotSequence(rows.stateRows),
    projects: buildProjects(rows.projectRows),
    threads: buildThreads(rows.threadRows, state),
    updatedAt: state.updatedAt ?? new Date(0).toISOString(),
  }
}

interface ProjectionSnapshotRowLoaders {
  readonly listProjectRows: () => Effect.Effect<
    ReadonlyArray<ProjectionSnapshotProjectRow>,
    ProjectionRepositoryError,
    never
  >
  readonly listThreadRows: () => Effect.Effect<
    ReadonlyArray<ProjectionSnapshotThreadRow>,
    ProjectionRepositoryError,
    never
  >
  readonly listThreadMessageRows: () => Effect.Effect<
    ReadonlyArray<ProjectionSnapshotMessageRow>,
    ProjectionRepositoryError,
    never
  >
  readonly listThreadProposedPlanRows: () => Effect.Effect<
    ReadonlyArray<ProjectionSnapshotProposedPlanRow>,
    ProjectionRepositoryError,
    never
  >
  readonly listThreadActivityRows: () => Effect.Effect<
    ReadonlyArray<ProjectionSnapshotActivityRow>,
    ProjectionRepositoryError,
    never
  >
  readonly listThreadSessionRows: () => Effect.Effect<
    ReadonlyArray<ProjectionSnapshotSessionRow>,
    ProjectionRepositoryError,
    never
  >
  readonly listCheckpointRows: () => Effect.Effect<
    ReadonlyArray<ProjectionSnapshotCheckpointRow>,
    ProjectionRepositoryError,
    never
  >
  readonly listLatestTurnRows: () => Effect.Effect<
    ReadonlyArray<ProjectionSnapshotLatestTurnRow>,
    ProjectionRepositoryError,
    never
  >
  readonly listProjectionStateRows: () => Effect.Effect<
    ReadonlyArray<ProjectionSnapshotStateRow>,
    ProjectionRepositoryError,
    never
  >
}

function loadProjectionSnapshotRows(
  input: ProjectionSnapshotRowLoaders
): Effect.Effect<ProjectionSnapshotRows, ProjectionRepositoryError> {
  return Effect.all({
    projectRows: input.listProjectRows(),
    threadRows: input.listThreadRows(),
    messageRows: input.listThreadMessageRows(),
    proposedPlanRows: input.listThreadProposedPlanRows(),
    activityRows: input.listThreadActivityRows(),
    sessionRows: input.listThreadSessionRows(),
    checkpointRows: input.listCheckpointRows(),
    latestTurnRows: input.listLatestTurnRows(),
    stateRows: input.listProjectionStateRows(),
  })
}

export function loadProjectionSnapshot(
  input: ProjectionSnapshotRowLoaders & {
    readonly computeSnapshotSequence: (rows: ReadonlyArray<ProjectionSnapshotStateRow>) => number
    readonly maxIso: (left: string | null, right: string) => string
    readonly decodeReadModel: (
      input: unknown
    ) => Effect.Effect<OrchestrationReadModel, ProjectionRepositoryError, never>
  }
): Effect.Effect<OrchestrationReadModel, ProjectionRepositoryError> {
  return Effect.gen(function* () {
    const rows = yield* loadProjectionSnapshotRows(input)
    const snapshot = assembleProjectionSnapshot(rows, input.computeSnapshotSequence, input.maxIso)
    return yield* input.decodeReadModel(snapshot)
  })
}
