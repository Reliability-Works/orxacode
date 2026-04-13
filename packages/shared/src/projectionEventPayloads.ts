// TODO(slice-J): apps/web/store.orchestrationEvents.ts duplicates equivalent
// payload-to-row mapping. Migrate apps/web handlers to consume these helpers
// in slice J so the client no longer owns a parallel copy.

import type { OrchestrationEvent, OrchestrationThread } from '@orxa-code/contracts'

type ProjectCreatedEvent = Extract<OrchestrationEvent, { type: 'project.created' }>
type ThreadCreatedEvent = Extract<OrchestrationEvent, { type: 'thread.created' }>
type ProjectMetaUpdatedEvent = Extract<OrchestrationEvent, { type: 'project.meta-updated' }>
type ThreadMetaUpdatedEvent = Extract<OrchestrationEvent, { type: 'thread.meta-updated' }>

export interface ProjectCreatedCoreFields {
  readonly projectId: ProjectCreatedEvent['payload']['projectId']
  readonly title: ProjectCreatedEvent['payload']['title']
  readonly workspaceRoot: ProjectCreatedEvent['payload']['workspaceRoot']
  readonly defaultModelSelection: ProjectCreatedEvent['payload']['defaultModelSelection']
  readonly scripts: ProjectCreatedEvent['payload']['scripts']
  readonly createdAt: ProjectCreatedEvent['payload']['createdAt']
  readonly updatedAt: ProjectCreatedEvent['payload']['updatedAt']
  readonly deletedAt: null
}

export function projectCreatedToCoreFields(event: ProjectCreatedEvent): ProjectCreatedCoreFields {
  return {
    projectId: event.payload.projectId,
    title: event.payload.title,
    workspaceRoot: event.payload.workspaceRoot,
    defaultModelSelection: event.payload.defaultModelSelection,
    scripts: event.payload.scripts,
    createdAt: event.payload.createdAt,
    updatedAt: event.payload.updatedAt,
    deletedAt: null,
  }
}

export interface ThreadCreatedCoreFields {
  readonly threadId: ThreadCreatedEvent['payload']['threadId']
  readonly projectId: ThreadCreatedEvent['payload']['projectId']
  readonly title: ThreadCreatedEvent['payload']['title']
  readonly modelSelection: ThreadCreatedEvent['payload']['modelSelection']
  readonly runtimeMode: ThreadCreatedEvent['payload']['runtimeMode']
  readonly interactionMode: ThreadCreatedEvent['payload']['interactionMode']
  readonly branch: ThreadCreatedEvent['payload']['branch']
  readonly worktreePath: ThreadCreatedEvent['payload']['worktreePath']
  readonly gitRoot: ThreadCreatedEvent['payload']['gitRoot']
  readonly handoff: OrchestrationThread['handoff']
  readonly parentLink: OrchestrationThread['parentLink']
  readonly createdAt: ThreadCreatedEvent['payload']['createdAt']
  readonly updatedAt: ThreadCreatedEvent['payload']['updatedAt']
  readonly archivedAt: null
  readonly deletedAt: null
}

export function threadCreatedToCoreFields(event: ThreadCreatedEvent): ThreadCreatedCoreFields {
  return {
    threadId: event.payload.threadId,
    projectId: event.payload.projectId,
    title: event.payload.title,
    modelSelection: event.payload.modelSelection,
    runtimeMode: event.payload.runtimeMode,
    interactionMode: event.payload.interactionMode,
    branch: event.payload.branch,
    worktreePath: event.payload.worktreePath,
    gitRoot: event.payload.gitRoot,
    handoff: event.payload.handoff ?? null,
    parentLink: event.payload.parentLink ?? null,
    createdAt: event.payload.createdAt,
    updatedAt: event.payload.updatedAt,
    archivedAt: null,
    deletedAt: null,
  }
}

export function projectMetaUpdatedToPatch(event: ProjectMetaUpdatedEvent) {
  return {
    ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
    ...(event.payload.workspaceRoot !== undefined
      ? { workspaceRoot: event.payload.workspaceRoot }
      : {}),
    ...(event.payload.defaultModelSelection !== undefined
      ? { defaultModelSelection: event.payload.defaultModelSelection }
      : {}),
    ...(event.payload.scripts !== undefined ? { scripts: event.payload.scripts } : {}),
  }
}

export function threadMetaUpdatedToPatch(event: ThreadMetaUpdatedEvent) {
  return {
    ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
    ...(event.payload.modelSelection !== undefined
      ? { modelSelection: event.payload.modelSelection }
      : {}),
    ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
    ...(event.payload.worktreePath !== undefined
      ? { worktreePath: event.payload.worktreePath }
      : {}),
    ...(event.payload.gitRoot !== undefined ? { gitRoot: event.payload.gitRoot } : {}),
  }
}
