import type { OrchestrationCommand, OrchestrationReadModel } from '@orxa-code/contracts'
import { Effect } from 'effect'

import { OrchestrationCommandInvariantError } from './Errors.ts'
import { requireProject, requireProjectAbsent } from './commandInvariants.ts'
import { nowIso, withEventBase } from './deciderShared.ts'

type ProjectCommand = Extract<
  OrchestrationCommand,
  {
    type: 'project.create' | 'project.meta.update' | 'project.delete'
  }
>

type ProjectCommandInput<TType extends ProjectCommand['type'] = ProjectCommand['type']> = {
  readonly command: Extract<ProjectCommand, { type: TType }>
  readonly readModel: OrchestrationReadModel
}

function decideProjectCreateCommand({ command, readModel }: ProjectCommandInput<'project.create'>) {
  return Effect.gen(function* () {
    yield* requireProjectAbsent({
      readModel,
      command,
      projectId: command.projectId,
    })

    return {
      ...withEventBase({
        aggregateKind: 'project',
        aggregateId: command.projectId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
      }),
      type: 'project.created' as const,
      payload: {
        projectId: command.projectId,
        title: command.title,
        workspaceRoot: command.workspaceRoot,
        defaultModelSelection: command.defaultModelSelection ?? null,
        scripts: [],
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      },
    }
  })
}

function buildProjectEventBase(
  command: Extract<ProjectCommand, { type: 'project.meta.update' | 'project.delete' }>,
  occurredAt: string
) {
  return withEventBase({
    aggregateKind: 'project',
    aggregateId: command.projectId,
    occurredAt,
    commandId: command.commandId,
  })
}

function requireProjectForExistingCommand(
  command: Extract<ProjectCommand, { type: 'project.meta.update' | 'project.delete' }>,
  readModel: OrchestrationReadModel
) {
  return requireProject({
    readModel,
    command,
    projectId: command.projectId,
  })
}

function decideProjectMetaUpdateCommand({
  command,
  readModel,
}: ProjectCommandInput<'project.meta.update'>) {
  return Effect.gen(function* () {
    yield* requireProjectForExistingCommand(command, readModel)
    const occurredAt = nowIso()
    return {
      ...buildProjectEventBase(command, occurredAt),
      type: 'project.meta-updated' as const,
      payload: {
        projectId: command.projectId,
        ...(command.title !== undefined ? { title: command.title } : {}),
        ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
        ...(command.defaultModelSelection !== undefined
          ? { defaultModelSelection: command.defaultModelSelection }
          : {}),
        ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
        updatedAt: occurredAt,
      },
    }
  })
}

function decideProjectDeleteCommand({ command, readModel }: ProjectCommandInput<'project.delete'>) {
  return Effect.gen(function* () {
    yield* requireProjectForExistingCommand(command, readModel)
    const occurredAt = nowIso()
    return {
      ...buildProjectEventBase(command, occurredAt),
      type: 'project.deleted' as const,
      payload: {
        projectId: command.projectId,
        deletedAt: occurredAt,
      },
    }
  })
}

export function decideProjectCommand(input: {
  readonly command: ProjectCommand
  readonly readModel: OrchestrationReadModel
}) {
  switch (input.command.type) {
    case 'project.create':
      return decideProjectCreateCommand({ command: input.command, readModel: input.readModel })
    case 'project.meta.update':
      return decideProjectMetaUpdateCommand({ command: input.command, readModel: input.readModel })
    case 'project.delete':
      return decideProjectDeleteCommand({ command: input.command, readModel: input.readModel })
  }

  const exhaustive: never = input.command
  throw new OrchestrationCommandInvariantError({
    commandType: 'project.delete',
    detail: `Unknown project command type: ${(exhaustive as { type: string }).type}`,
  })
}
