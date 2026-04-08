import {
  CommandId,
  CorrelationId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
} from '@orxa-code/contracts'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'

import { OrchestrationCommandReceiptRepositoryLive } from '../../persistence/Layers/OrchestrationCommandReceipts.ts'
import { OrchestrationEventStoreLive } from '../../persistence/Layers/OrchestrationEventStore.ts'
import { SqlitePersistenceMemory } from '../../persistence/Layers/Sqlite.ts'
import { OrchestrationEventStore } from '../../persistence/Services/OrchestrationEventStore.ts'
import { OrchestrationEngineLive } from './OrchestrationEngine.ts'
import { OrchestrationProjectionPipelineLive } from './ProjectionPipeline.ts'
import { OrchestrationProjectionSnapshotQueryLive } from './ProjectionSnapshotQuery.ts'
import { OrchestrationEngineService } from '../Services/OrchestrationEngine.ts'
import { OrchestrationProjectionPipeline } from '../Services/ProjectionPipeline.ts'
import { ServerConfig } from '../../config.ts'
import {
  bootstrapProjectionRowsEffect,
  resumeFromProjectorLastAppliedSequenceEffect,
} from './ProjectionPipeline.test.bootstrap.helpers.ts'
import {
  overwriteAttachmentReferencesEffect,
  passThroughEmptyAttachmentsEffect,
  rollbackAttachmentProjectionEffect,
} from './ProjectionPipeline.test.attachments.helpers.ts'
import {
  removeThreadAttachmentDirectoryOnDeleteEffect,
  removeUnreferencedRevertedAttachmentsEffect,
} from './ProjectionPipeline.test.attachments-revert.helpers.ts'
import {
  doesNotFallbackRetainRevertedMessagesEffect,
  keepAssistantTextOnEmptyCompletionEffect,
  resolveTurnCountConflictsEffect,
} from './ProjectionPipeline.test.lifecycle.helpers.ts'
import { restorePendingTurnStartMetadataAfterRestartEffect } from './ProjectionPipeline.test.restart.helpers.ts'

const makeProjectionPipelinePrefixedTestLayer = (prefix: string) =>
  OrchestrationProjectionPipelineLive.pipe(
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix })),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer)
  )

const exists = (filePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const fileInfo = yield* Effect.result(fileSystem.stat(filePath))
    return fileInfo._tag === 'Success'
  })

const BaseTestLayer = makeProjectionPipelinePrefixedTestLayer('orxa-projection-pipeline-test-')

it.layer(BaseTestLayer)('OrchestrationProjectionPipeline', it => {
  it.effect(
    'bootstraps all projection states and writes projection rows',
    bootstrapProjectionRowsEffect
  )
})

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer('orxa-base-')))(
  'OrchestrationProjectionPipeline',
  it => {
    it.effect('stores message attachment references without mutating payloads', () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline
        const eventStore = yield* OrchestrationEventStore
        const sql = yield* SqlClient.SqlClient
        const now = new Date().toISOString()

        yield* eventStore.append({
          type: 'thread.message-sent',
          eventId: EventId.makeUnsafe('evt-attachments'),
          aggregateKind: 'thread',
          aggregateId: ThreadId.makeUnsafe('thread-attachments'),
          occurredAt: now,
          commandId: CommandId.makeUnsafe('cmd-attachments'),
          causationEventId: null,
          correlationId: CommandId.makeUnsafe('cmd-attachments'),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe('thread-attachments'),
            messageId: MessageId.makeUnsafe('message-attachments'),
            role: 'user',
            text: 'Inspect this',
            attachments: [
              {
                type: 'image',
                id: 'thread-attachments-att-1',
                name: 'example.png',
                mimeType: 'image/png',
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        })

        yield* projectionPipeline.bootstrap

        const rows = yield* sql<{
          readonly attachmentsJson: string | null
        }>`
            SELECT
              attachments_json AS "attachmentsJson"
            FROM projection_thread_messages
            WHERE message_id = 'message-attachments'
          `
        assert.equal(rows.length, 1)
        assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? 'null'), [
          {
            type: 'image',
            id: 'thread-attachments-att-1',
            name: 'example.png',
            mimeType: 'image/png',
            sizeBytes: 5,
          },
        ])
      })
    )
  }
)

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer('orxa-projection-attachments-safe-')))(
  'OrchestrationProjectionPipeline',
  it => {
    it.effect('preserves mixed image attachment metadata as-is', () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline
        const eventStore = yield* OrchestrationEventStore
        const sql = yield* SqlClient.SqlClient
        const now = new Date().toISOString()

        yield* eventStore.append({
          type: 'thread.message-sent',
          eventId: EventId.makeUnsafe('evt-attachments-safe'),
          aggregateKind: 'thread',
          aggregateId: ThreadId.makeUnsafe('thread-attachments-safe'),
          occurredAt: now,
          commandId: CommandId.makeUnsafe('cmd-attachments-safe'),
          causationEventId: null,
          correlationId: CommandId.makeUnsafe('cmd-attachments-safe'),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe('thread-attachments-safe'),
            messageId: MessageId.makeUnsafe('message-attachments-safe'),
            role: 'user',
            text: 'Inspect this',
            attachments: [
              {
                type: 'image',
                id: 'thread-attachments-safe-att-1',
                name: 'untrusted.exe',
                mimeType: 'image/x-unknown',
                sizeBytes: 5,
              },
              {
                type: 'image',
                id: 'thread-attachments-safe-att-2',
                name: 'not-image.png',
                mimeType: 'image/png',
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        })

        yield* projectionPipeline.bootstrap

        const rows = yield* sql<{
          readonly attachmentsJson: string | null
        }>`
            SELECT
              attachments_json AS "attachmentsJson"
            FROM projection_thread_messages
            WHERE message_id = 'message-attachments-safe'
          `
        assert.equal(rows.length, 1)
        assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? 'null'), [
          {
            type: 'image',
            id: 'thread-attachments-safe-att-1',
            name: 'untrusted.exe',
            mimeType: 'image/x-unknown',
            sizeBytes: 5,
          },
          {
            type: 'image',
            id: 'thread-attachments-safe-att-2',
            name: 'not-image.png',
            mimeType: 'image/png',
            sizeBytes: 5,
          },
        ])
      })
    )
  }
)

it.layer(BaseTestLayer)('OrchestrationProjectionPipeline', it => {
  it.effect(
    'passes explicit empty attachment arrays through the projection pipeline to clear attachments',
    passThroughEmptyAttachmentsEffect
  )
})

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer('orxa-projection-attachments-overwrite-'))
)('OrchestrationProjectionPipeline', it => {
  it.effect(
    'overwrites stored attachment references when a message updates attachments',
    overwriteAttachmentReferencesEffect
  )
})

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer('orxa-projection-attachments-rollback-'))
)('OrchestrationProjectionPipeline', it => {
  it.effect(
    'does not persist attachment files when projector transaction rolls back',
    rollbackAttachmentProjectionEffect
  )
})

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer('orxa-projection-attachments-overwrite-'))
)('OrchestrationProjectionPipeline', it => {
  it.effect(
    'removes unreferenced attachment files when a thread is reverted',
    removeUnreferencedRevertedAttachmentsEffect
  )
})

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer('orxa-projection-attachments-revert-'))
)('OrchestrationProjectionPipeline', it => {
  it.effect(
    'removes thread attachment directory when thread is deleted',
    removeThreadAttachmentDirectoryOnDeleteEffect
  )
})

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer('orxa-projection-attachments-delete-'))
)('OrchestrationProjectionPipeline', it => {
  it.effect('ignores unsafe thread ids for attachment cleanup paths', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const projectionPipeline = yield* OrchestrationProjectionPipeline
      const eventStore = yield* OrchestrationEventStore
      const now = new Date().toISOString()
      const { attachmentsDir: attachmentsRootDir, stateDir } = yield* ServerConfig
      const attachmentsSentinelPath = path.join(attachmentsRootDir, 'sentinel.txt')
      const stateDirSentinelPath = path.join(stateDir, 'state-sentinel.txt')
      yield* fileSystem.makeDirectory(attachmentsRootDir, { recursive: true })
      yield* fileSystem.writeFileString(attachmentsSentinelPath, 'keep-attachments-root')
      yield* fileSystem.writeFileString(stateDirSentinelPath, 'keep-state-dir')

      yield* eventStore.append({
        type: 'thread.deleted',
        eventId: EventId.makeUnsafe('evt-unsafe-thread-delete'),
        aggregateKind: 'thread',
        aggregateId: ThreadId.makeUnsafe('..'),
        occurredAt: now,
        commandId: CommandId.makeUnsafe('cmd-unsafe-thread-delete'),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe('cmd-unsafe-thread-delete'),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe('..'),
          deletedAt: now,
        },
      })

      yield* projectionPipeline.bootstrap

      assert.isTrue(yield* exists(attachmentsRootDir))
      assert.isTrue(yield* exists(attachmentsSentinelPath))
      assert.isTrue(yield* exists(stateDirSentinelPath))
    })
  )
})

it.layer(BaseTestLayer)('OrchestrationProjectionPipeline', it => {
  it.effect(
    'resumes from projector last_applied_sequence without replaying older events',
    resumeFromProjectorLastAppliedSequenceEffect
  )

  it.effect(
    'keeps accumulated assistant text when completion payload text is empty',
    keepAssistantTextOnEmptyCompletionEffect
  )

  it.effect(
    'resolves turn-count conflicts when checkpoint completion rewrites provisional turns',
    resolveTurnCountConflictsEffect
  )

  it.effect(
    'does not fallback-retain messages whose turnId is removed by revert',
    doesNotFallbackRetainRevertedMessagesEffect
  )
})

it.effect(
  'restores pending turn-start metadata across projection pipeline restart',
  restorePendingTurnStartMetadataAfterRestartEffect
)

const engineLayer = it.layer(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), {
        prefix: 'orxa-projection-pipeline-engine-dispatch-',
      })
    ),
    Layer.provideMerge(NodeServices.layer)
  )
)

engineLayer('OrchestrationProjectionPipeline via engine dispatch', it => {
  it.effect('projects dispatched engine events immediately', () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService
      const sql = yield* SqlClient.SqlClient
      const createdAt = new Date().toISOString()

      yield* engine.dispatch({
        type: 'project.create',
        commandId: CommandId.makeUnsafe('cmd-live-project'),
        projectId: ProjectId.makeUnsafe('project-live'),
        title: 'Live Project',
        workspaceRoot: '/tmp/project-live',
        defaultModelSelection: {
          provider: 'codex',
          model: 'gpt-5-codex',
        },
        createdAt,
      })

      const projectRows = yield* sql<{ readonly title: string; readonly scriptsJson: string }>`
        SELECT
          title,
          scripts_json AS "scriptsJson"
        FROM projection_projects
        WHERE project_id = 'project-live'
      `
      assert.deepEqual(projectRows, [{ title: 'Live Project', scriptsJson: '[]' }])

      const projectorRows = yield* sql<{ readonly lastAppliedSequence: number }>`
        SELECT
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        WHERE projector = 'projection.projects'
      `
      assert.deepEqual(projectorRows, [{ lastAppliedSequence: 1 }])
    })
  )
})

engineLayer('OrchestrationProjectionPipeline via engine dispatch', it => {
  it.effect('projects persist updated scripts from project.meta.update', () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService
      const sql = yield* SqlClient.SqlClient
      const createdAt = new Date().toISOString()

      yield* engine.dispatch({
        type: 'project.create',
        commandId: CommandId.makeUnsafe('cmd-scripts-project-create'),
        projectId: ProjectId.makeUnsafe('project-scripts'),
        title: 'Scripts Project',
        workspaceRoot: '/tmp/project-scripts',
        defaultModelSelection: {
          provider: 'codex',
          model: 'gpt-5-codex',
        },
        createdAt,
      })

      yield* engine.dispatch({
        type: 'project.meta.update',
        commandId: CommandId.makeUnsafe('cmd-scripts-project-update'),
        projectId: ProjectId.makeUnsafe('project-scripts'),
        scripts: [
          {
            id: 'script-1',
            name: 'Build',
            command: 'bun run build',
            icon: 'build',
            runOnWorktreeCreate: false,
          },
        ],
        defaultModelSelection: {
          provider: 'codex',
          model: 'gpt-5',
        },
      })

      const projectRows = yield* sql<{
        readonly scriptsJson: string
        readonly defaultModelSelection: string
      }>`
        SELECT
          scripts_json AS "scriptsJson",
          default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-scripts'
      `
      assert.deepEqual(projectRows, [
        {
          scriptsJson:
            '[{"id":"script-1","name":"Build","command":"bun run build","icon":"build","runOnWorktreeCreate":false}]',
          defaultModelSelection: '{"provider":"codex","model":"gpt-5"}',
        },
      ])
    })
  )
})
