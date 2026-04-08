import {
  CheckpointRef,
  CommandId,
  CorrelationId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { assert } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'

import { ServerConfig } from '../../config.ts'
import { exists, makeAppendAndProject } from './ProjectionPipeline.test.shared.helpers.ts'

// ---------------- removeUnreferencedRevertedAttachments ----------------

interface RevertFilesIds {
  readonly threadId: ThreadId
  readonly keepAttachmentId: string
  readonly removeAttachmentId: string
  readonly otherThreadAttachmentId: string
}

function* seedRevertFilesProjectAndThread(now: string, ids: RevertFilesIds) {
  const appendAndProject = yield* makeAppendAndProject()

  yield* appendAndProject({
    type: 'project.created',
    eventId: EventId.makeUnsafe('evt-revert-files-1'),
    aggregateKind: 'project',
    aggregateId: ProjectId.makeUnsafe('project-revert-files'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-revert-files-1'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-files-1'),
    metadata: {},
    payload: {
      projectId: ProjectId.makeUnsafe('project-revert-files'),
      title: 'Project Revert Files',
      workspaceRoot: '/tmp/project-revert-files',
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  })

  yield* appendAndProject({
    type: 'thread.created',
    eventId: EventId.makeUnsafe('evt-revert-files-2'),
    aggregateKind: 'thread',
    aggregateId: ids.threadId,
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-revert-files-2'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-files-2'),
    metadata: {},
    payload: {
      threadId: ids.threadId,
      projectId: ProjectId.makeUnsafe('project-revert-files'),
      title: 'Thread Revert Files',
      modelSelection: { provider: 'codex', model: 'gpt-5-codex' },
      runtimeMode: 'full-access',
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  })
}

function* seedRevertFilesKeepTurn(now: string, ids: RevertFilesIds) {
  const appendAndProject = yield* makeAppendAndProject()

  yield* appendAndProject({
    type: 'thread.turn-diff-completed',
    eventId: EventId.makeUnsafe('evt-revert-files-3'),
    aggregateKind: 'thread',
    aggregateId: ids.threadId,
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-revert-files-3'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-files-3'),
    metadata: {},
    payload: {
      threadId: ids.threadId,
      turnId: TurnId.makeUnsafe('turn-keep'),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.makeUnsafe(
        'refs/orxacode/checkpoints/thread-revert-files/turn/1'
      ),
      status: 'ready',
      files: [],
      assistantMessageId: MessageId.makeUnsafe('message-keep'),
      completedAt: now,
    },
  })

  yield* appendAndProject({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-revert-files-4'),
    aggregateKind: 'thread',
    aggregateId: ids.threadId,
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-revert-files-4'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-files-4'),
    metadata: {},
    payload: {
      threadId: ids.threadId,
      messageId: MessageId.makeUnsafe('message-keep'),
      role: 'assistant',
      text: 'Keep',
      attachments: [
        {
          type: 'image',
          id: ids.keepAttachmentId,
          name: 'keep.png',
          mimeType: 'image/png',
          sizeBytes: 5,
        },
      ],
      turnId: TurnId.makeUnsafe('turn-keep'),
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
  })
}

function* seedRevertFilesRemoveTurn(now: string, ids: RevertFilesIds) {
  const appendAndProject = yield* makeAppendAndProject()

  yield* appendAndProject({
    type: 'thread.turn-diff-completed',
    eventId: EventId.makeUnsafe('evt-revert-files-5'),
    aggregateKind: 'thread',
    aggregateId: ids.threadId,
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-revert-files-5'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-files-5'),
    metadata: {},
    payload: {
      threadId: ids.threadId,
      turnId: TurnId.makeUnsafe('turn-remove'),
      checkpointTurnCount: 2,
      checkpointRef: CheckpointRef.makeUnsafe(
        'refs/orxacode/checkpoints/thread-revert-files/turn/2'
      ),
      status: 'ready',
      files: [],
      assistantMessageId: MessageId.makeUnsafe('message-remove'),
      completedAt: now,
    },
  })

  yield* appendAndProject({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-revert-files-6'),
    aggregateKind: 'thread',
    aggregateId: ids.threadId,
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-revert-files-6'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-files-6'),
    metadata: {},
    payload: {
      threadId: ids.threadId,
      messageId: MessageId.makeUnsafe('message-remove'),
      role: 'assistant',
      text: 'Remove',
      attachments: [
        {
          type: 'image',
          id: ids.removeAttachmentId,
          name: 'remove.png',
          mimeType: 'image/png',
          sizeBytes: 5,
        },
      ],
      turnId: TurnId.makeUnsafe('turn-remove'),
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
  })
}

interface RevertFilesPaths {
  readonly keepPath: string
  readonly removePath: string
  readonly otherThreadPath: string
}

const createRevertFilesAttachments = (ids: RevertFilesIds) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const { attachmentsDir } = yield* ServerConfig
    const keepPath = path.join(attachmentsDir, `${ids.keepAttachmentId}.png`)
    const removePath = path.join(attachmentsDir, `${ids.removeAttachmentId}.png`)
    const otherThreadPath = path.join(attachmentsDir, `${ids.otherThreadAttachmentId}.png`)
    yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true })
    yield* fileSystem.writeFileString(keepPath, 'keep')
    yield* fileSystem.writeFileString(removePath, 'remove')
    yield* fileSystem.writeFileString(otherThreadPath, 'other')
    assert.isTrue(yield* exists(keepPath))
    assert.isTrue(yield* exists(removePath))
    assert.isTrue(yield* exists(otherThreadPath))
    const paths: RevertFilesPaths = { keepPath, removePath, otherThreadPath }
    return paths
  })

function* dispatchRevertAndAssert(now: string, ids: RevertFilesIds, paths: RevertFilesPaths) {
  const appendAndProject = yield* makeAppendAndProject()
  yield* appendAndProject({
    type: 'thread.reverted',
    eventId: EventId.makeUnsafe('evt-revert-files-7'),
    aggregateKind: 'thread',
    aggregateId: ids.threadId,
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-revert-files-7'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-files-7'),
    metadata: {},
    payload: {
      threadId: ids.threadId,
      turnCount: 1,
    },
  })

  assert.isTrue(yield* exists(paths.keepPath))
  assert.isFalse(yield* exists(paths.removePath))
  assert.isTrue(yield* exists(paths.otherThreadPath))
}

export function* removeUnreferencedRevertedAttachmentsProgram() {
  const now = new Date().toISOString()
  const ids: RevertFilesIds = {
    threadId: ThreadId.makeUnsafe('Thread Revert.Files'),
    keepAttachmentId: 'thread-revert-files-00000000-0000-4000-8000-000000000001',
    removeAttachmentId: 'thread-revert-files-00000000-0000-4000-8000-000000000002',
    otherThreadAttachmentId: 'thread-revert-files-extra-00000000-0000-4000-8000-000000000003',
  }
  yield* seedRevertFilesProjectAndThread(now, ids)
  yield* seedRevertFilesKeepTurn(now, ids)
  yield* seedRevertFilesRemoveTurn(now, ids)
  const paths = yield* createRevertFilesAttachments(ids)
  yield* dispatchRevertAndAssert(now, ids, paths)
}

export const removeUnreferencedRevertedAttachmentsEffect = () =>
  Effect.gen(removeUnreferencedRevertedAttachmentsProgram)

// ---------------- removeThreadAttachmentDirectoryOnDelete ----------------

interface DeleteFilesIds {
  readonly threadId: ThreadId
  readonly attachmentId: string
  readonly otherThreadAttachmentId: string
}

function* seedDeleteFilesProjectAndThread(now: string, ids: DeleteFilesIds) {
  const appendAndProject = yield* makeAppendAndProject()

  yield* appendAndProject({
    type: 'project.created',
    eventId: EventId.makeUnsafe('evt-delete-files-1'),
    aggregateKind: 'project',
    aggregateId: ProjectId.makeUnsafe('project-delete-files'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-delete-files-1'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-delete-files-1'),
    metadata: {},
    payload: {
      projectId: ProjectId.makeUnsafe('project-delete-files'),
      title: 'Project Delete Files',
      workspaceRoot: '/tmp/project-delete-files',
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  })

  yield* appendAndProject({
    type: 'thread.created',
    eventId: EventId.makeUnsafe('evt-delete-files-2'),
    aggregateKind: 'thread',
    aggregateId: ids.threadId,
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-delete-files-2'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-delete-files-2'),
    metadata: {},
    payload: {
      threadId: ids.threadId,
      projectId: ProjectId.makeUnsafe('project-delete-files'),
      title: 'Thread Delete Files',
      modelSelection: { provider: 'codex', model: 'gpt-5-codex' },
      runtimeMode: 'full-access',
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  })
}

function* seedDeleteFilesMessage(now: string, ids: DeleteFilesIds) {
  const appendAndProject = yield* makeAppendAndProject()
  yield* appendAndProject({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-delete-files-3'),
    aggregateKind: 'thread',
    aggregateId: ids.threadId,
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-delete-files-3'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-delete-files-3'),
    metadata: {},
    payload: {
      threadId: ids.threadId,
      messageId: MessageId.makeUnsafe('message-delete-files'),
      role: 'user',
      text: 'Delete',
      attachments: [
        {
          type: 'image',
          id: ids.attachmentId,
          name: 'delete.png',
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
}

interface DeleteFilesPaths {
  readonly threadAttachmentPath: string
  readonly otherThreadAttachmentPath: string
}

const createDeleteFilesAttachments = (ids: DeleteFilesIds) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const { attachmentsDir } = yield* ServerConfig
    const threadAttachmentPath = path.join(attachmentsDir, `${ids.attachmentId}.png`)
    const otherThreadAttachmentPath = path.join(
      attachmentsDir,
      `${ids.otherThreadAttachmentId}.png`
    )
    yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true })
    yield* fileSystem.writeFileString(threadAttachmentPath, 'delete')
    yield* fileSystem.writeFileString(otherThreadAttachmentPath, 'other-thread')
    assert.isTrue(yield* exists(threadAttachmentPath))
    assert.isTrue(yield* exists(otherThreadAttachmentPath))
    const paths: DeleteFilesPaths = {
      threadAttachmentPath,
      otherThreadAttachmentPath,
    }
    return paths
  })

function* dispatchDeleteAndAssert(now: string, ids: DeleteFilesIds, paths: DeleteFilesPaths) {
  const appendAndProject = yield* makeAppendAndProject()
  yield* appendAndProject({
    type: 'thread.deleted',
    eventId: EventId.makeUnsafe('evt-delete-files-4'),
    aggregateKind: 'thread',
    aggregateId: ids.threadId,
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-delete-files-4'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-delete-files-4'),
    metadata: {},
    payload: {
      threadId: ids.threadId,
      deletedAt: now,
    },
  })
  assert.isFalse(yield* exists(paths.threadAttachmentPath))
  assert.isTrue(yield* exists(paths.otherThreadAttachmentPath))
}

export function* removeThreadAttachmentDirectoryOnDeleteProgram() {
  const now = new Date().toISOString()
  const ids: DeleteFilesIds = {
    threadId: ThreadId.makeUnsafe('Thread Delete.Files'),
    attachmentId: 'thread-delete-files-00000000-0000-4000-8000-000000000001',
    otherThreadAttachmentId: 'thread-delete-files-extra-00000000-0000-4000-8000-000000000002',
  }
  yield* seedDeleteFilesProjectAndThread(now, ids)
  yield* seedDeleteFilesMessage(now, ids)
  const paths = yield* createDeleteFilesAttachments(ids)
  yield* dispatchDeleteAndAssert(now, ids, paths)
}

export const removeThreadAttachmentDirectoryOnDeleteEffect = () =>
  Effect.gen(removeThreadAttachmentDirectoryOnDeleteProgram)
