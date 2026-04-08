import type {
  OrchestrationEvent,
  OrchestrationProject,
  OrchestrationReadModel,
} from '@orxa-code/contracts'
import { Effect } from 'effect'

import {
  ProjectCreatedPayload,
  ProjectDeletedPayload,
  ProjectMetaUpdatedPayload,
} from './Schemas.ts'
import { decodeForEvent } from './projector.shared.ts'

function updateProjectById(
  nextBase: OrchestrationReadModel,
  projectId: OrchestrationProject['id'],
  updater: (project: OrchestrationProject) => OrchestrationProject
): OrchestrationReadModel {
  return {
    ...nextBase,
    projects: nextBase.projects.map(project =>
      project.id === projectId ? updater(project) : project
    ),
  }
}

export function handleProjectEvent(nextBase: OrchestrationReadModel, event: OrchestrationEvent) {
  switch (event.type) {
    case 'project.created':
      return decodeForEvent(ProjectCreatedPayload, event.payload, event.type, 'payload').pipe(
        Effect.map(payload => {
          const existing = nextBase.projects.find(entry => entry.id === payload.projectId)
          const nextProject = {
            id: payload.projectId,
            title: payload.title,
            workspaceRoot: payload.workspaceRoot,
            defaultModelSelection: payload.defaultModelSelection,
            scripts: payload.scripts,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
          }

          return {
            ...nextBase,
            projects: existing
              ? nextBase.projects.map(entry =>
                  entry.id === payload.projectId ? nextProject : entry
                )
              : [...nextBase.projects, nextProject],
          }
        })
      )

    case 'project.meta-updated':
      return decodeForEvent(ProjectMetaUpdatedPayload, event.payload, event.type, 'payload').pipe(
        Effect.map(payload =>
          updateProjectById(nextBase, payload.projectId, project => ({
            ...project,
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.workspaceRoot !== undefined
              ? { workspaceRoot: payload.workspaceRoot }
              : {}),
            ...(payload.defaultModelSelection !== undefined
              ? { defaultModelSelection: payload.defaultModelSelection }
              : {}),
            ...(payload.scripts !== undefined ? { scripts: payload.scripts } : {}),
            updatedAt: payload.updatedAt,
          }))
        )
      )

    case 'project.deleted':
      return decodeForEvent(ProjectDeletedPayload, event.payload, event.type, 'payload').pipe(
        Effect.map(payload =>
          updateProjectById(nextBase, payload.projectId, project => ({
            ...project,
            deletedAt: payload.deletedAt,
            updatedAt: payload.deletedAt,
          }))
        )
      )

    default:
      return undefined
  }
}
