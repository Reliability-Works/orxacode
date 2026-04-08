import * as SqlClient from 'effect/unstable/sql/SqlClient'
import * as SqlSchema from 'effect/unstable/sql/SqlSchema'
import { Effect, Layer, Schema, Struct } from 'effect'

import { ModelSelection, ProjectScript } from '@orxa-code/contracts'
import { toPersistenceSqlError } from '../Errors.ts'
import {
  DeleteProjectionProjectInput,
  GetProjectionProjectInput,
  ProjectionProject,
  ProjectionProjectRepository,
  type ProjectionProjectRepositoryShape,
} from '../Services/ProjectionProjects.ts'

const ProjectionProjectDbRow = ProjectionProject.mapFields(
  Struct.assign({
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
  })
)
type ProjectionProjectDbRow = typeof ProjectionProjectDbRow.Type

function makeUpsertProjectionProjectRow(sql: SqlClient.SqlClient) {
  return SqlSchema.void({
    Request: ProjectionProject,
    execute: row =>
      sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          ${row.projectId},
          ${row.title},
          ${row.workspaceRoot},
          ${row.defaultModelSelection !== null ? JSON.stringify(row.defaultModelSelection) : null},
          ${JSON.stringify(row.scripts)},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (project_id)
        DO UPDATE SET
          title = excluded.title,
          workspace_root = excluded.workspace_root,
          default_model_selection_json = excluded.default_model_selection_json,
          scripts_json = excluded.scripts_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `,
  })
}

function makeGetProjectionProjectRow(sql: SqlClient.SqlClient) {
  return SqlSchema.findOneOption({
    Request: GetProjectionProjectInput,
    Result: ProjectionProjectDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE project_id = ${projectId}
      `,
  })
}

function makeListProjectionProjectRows(sql: SqlClient.SqlClient) {
  return SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRow,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        ORDER BY created_at ASC, project_id ASC
      `,
  })
}

function makeDeleteProjectionProjectRow(sql: SqlClient.SqlClient) {
  return SqlSchema.void({
    Request: DeleteProjectionProjectInput,
    execute: ({ projectId }) =>
      sql`
        DELETE FROM projection_projects
        WHERE project_id = ${projectId}
      `,
  })
}

const makeProjectionProjectRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const upsertProjectionProjectRow = makeUpsertProjectionProjectRow(sql)
  const getProjectionProjectRow = makeGetProjectionProjectRow(sql)
  const listProjectionProjectRows = makeListProjectionProjectRows(sql)
  const deleteProjectionProjectRow = makeDeleteProjectionProjectRow(sql)

  const upsert: ProjectionProjectRepositoryShape['upsert'] = row =>
    upsertProjectionProjectRow(row).pipe(
      Effect.mapError(toPersistenceSqlError('ProjectionProjectRepository.upsert:query'))
    )

  const getById: ProjectionProjectRepositoryShape['getById'] = input =>
    getProjectionProjectRow(input).pipe(
      Effect.mapError(toPersistenceSqlError('ProjectionProjectRepository.getById:query'))
    )

  const listAll: ProjectionProjectRepositoryShape['listAll'] = () =>
    listProjectionProjectRows().pipe(
      Effect.mapError(toPersistenceSqlError('ProjectionProjectRepository.listAll:query'))
    )

  const deleteById: ProjectionProjectRepositoryShape['deleteById'] = input =>
    deleteProjectionProjectRow(input).pipe(
      Effect.mapError(toPersistenceSqlError('ProjectionProjectRepository.deleteById:query'))
    )

  return {
    upsert,
    getById,
    listAll,
    deleteById,
  } satisfies ProjectionProjectRepositoryShape
})

export const ProjectionProjectRepositoryLive = Layer.effect(
  ProjectionProjectRepository,
  makeProjectionProjectRepository
)
