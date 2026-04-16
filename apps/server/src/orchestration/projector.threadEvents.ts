import {
  type OrchestrationEvent,
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationSession,
  OrchestrationThread,
  type OrchestrationReadModel,
} from '@orxa-code/contracts'
import { Effect } from 'effect'

import {
  MessageSentPayloadSchema,
  ThreadActivityAppendedPayload,
  ThreadArchivedPayload,
  ThreadCreatedPayload,
  ThreadDeletedPayload,
  ThreadInteractionModeSetPayload,
  ThreadMetaUpdatedPayload,
  ThreadProposedPlanUpsertedPayload,
  ThreadRuntimeModeSetPayload,
  ThreadUnarchivedPayload,
  ThreadRevertedPayload,
  ThreadSessionSetPayload,
  ThreadTurnDiffCompletedPayload,
} from './Schemas.ts'
import {
  checkpointStatusToLatestTurnState,
  compareThreadActivities,
  decodeForEvent,
  findThread,
  MAX_THREAD_CHECKPOINTS,
  MAX_THREAD_MESSAGES,
  retainThreadActivitiesAfterRevert,
  retainThreadMessagesAfterRevert,
  retainThreadProposedPlansAfterRevert,
  updateThread,
} from './projector.shared.ts'

function handleThreadCreatedEvent(nextBase: OrchestrationReadModel, event: OrchestrationEvent) {
  return Effect.gen(function* () {
    const payload = yield* decodeForEvent(
      ThreadCreatedPayload,
      event.payload,
      event.type,
      'payload'
    )
    const thread: OrchestrationThread = yield* decodeForEvent(
      OrchestrationThread,
      {
        id: payload.threadId,
        projectId: payload.projectId,
        title: payload.title,
        modelSelection: payload.modelSelection,
        runtimeMode: payload.runtimeMode,
        interactionMode: payload.interactionMode,
        branch: payload.branch,
        worktreePath: payload.worktreePath,
        gitRoot: payload.gitRoot ?? null,
        parentBranch: payload.parentBranch ?? null,
        handoff: payload.handoff ?? null,
        parentLink: payload.parentLink ?? null,
        latestTurn: null,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        archivedAt: null,
        deletedAt: null,
        messages: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
      event.type,
      'thread'
    )
    const existing = findThread(nextBase, thread.id)
    return {
      ...nextBase,
      threads: existing
        ? nextBase.threads.map(entry => (entry.id === thread.id ? thread : entry))
        : [...nextBase.threads, thread],
    }
  })
}

function handleThreadDeletedEvent(nextBase: OrchestrationReadModel, event: OrchestrationEvent) {
  return decodeForEvent(ThreadDeletedPayload, event.payload, event.type, 'payload').pipe(
    Effect.map(payload => ({
      ...nextBase,
      threads: updateThread(nextBase.threads, payload.threadId, {
        deletedAt: payload.deletedAt,
        updatedAt: payload.deletedAt,
      }),
    }))
  )
}

function handleThreadArchivedEvent(nextBase: OrchestrationReadModel, event: OrchestrationEvent) {
  return decodeForEvent(ThreadArchivedPayload, event.payload, event.type, 'payload').pipe(
    Effect.map(payload => ({
      ...nextBase,
      threads: updateThread(nextBase.threads, payload.threadId, {
        archivedAt: payload.archivedAt,
        updatedAt: payload.updatedAt,
      }),
    }))
  )
}

function handleThreadUnarchivedEvent(nextBase: OrchestrationReadModel, event: OrchestrationEvent) {
  return decodeForEvent(ThreadUnarchivedPayload, event.payload, event.type, 'payload').pipe(
    Effect.map(payload => ({
      ...nextBase,
      threads: updateThread(nextBase.threads, payload.threadId, {
        archivedAt: null,
        updatedAt: payload.updatedAt,
      }),
    }))
  )
}

function handleThreadMetaUpdatedEvent(nextBase: OrchestrationReadModel, event: OrchestrationEvent) {
  return decodeForEvent(ThreadMetaUpdatedPayload, event.payload, event.type, 'payload').pipe(
    Effect.map(payload => ({
      ...nextBase,
      threads: updateThread(nextBase.threads, payload.threadId, {
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.modelSelection !== undefined ? { modelSelection: payload.modelSelection } : {}),
        ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
        ...(payload.worktreePath !== undefined ? { worktreePath: payload.worktreePath } : {}),
        ...(payload.gitRoot !== undefined ? { gitRoot: payload.gitRoot } : {}),
        ...(payload.parentBranch !== undefined ? { parentBranch: payload.parentBranch } : {}),
        updatedAt: payload.updatedAt,
      }),
    }))
  )
}

function handleThreadRuntimeModeSetEvent(
  nextBase: OrchestrationReadModel,
  event: OrchestrationEvent
) {
  return decodeForEvent(ThreadRuntimeModeSetPayload, event.payload, event.type, 'payload').pipe(
    Effect.map(payload => ({
      ...nextBase,
      threads: updateThread(nextBase.threads, payload.threadId, {
        runtimeMode: payload.runtimeMode,
        updatedAt: payload.updatedAt,
      }),
    }))
  )
}

function handleThreadInteractionModeSetEvent(
  nextBase: OrchestrationReadModel,
  event: OrchestrationEvent
) {
  return decodeForEvent(ThreadInteractionModeSetPayload, event.payload, event.type, 'payload').pipe(
    Effect.map(payload => ({
      ...nextBase,
      threads: updateThread(nextBase.threads, payload.threadId, {
        interactionMode: payload.interactionMode,
        updatedAt: payload.updatedAt,
      }),
    }))
  )
}

function handleThreadMessageSentEvent(nextBase: OrchestrationReadModel, event: OrchestrationEvent) {
  return Effect.gen(function* () {
    const payload = yield* decodeForEvent(
      MessageSentPayloadSchema,
      event.payload,
      event.type,
      'payload'
    )
    const thread = findThread(nextBase, payload.threadId)
    if (!thread) {
      return nextBase
    }

    const message: OrchestrationMessage = yield* decodeForEvent(
      OrchestrationMessage,
      {
        id: payload.messageId,
        role: payload.role,
        text: payload.text,
        ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
        turnId: payload.turnId,
        streaming: payload.streaming,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
      },
      event.type,
      'message'
    )

    const existingMessage = thread.messages.find(entry => entry.id === message.id)
    const messages = existingMessage
      ? thread.messages.map(entry =>
          entry.id === message.id
            ? {
                ...entry,
                text: message.streaming
                  ? `${entry.text}${message.text}`
                  : message.text.length > 0
                    ? message.text
                    : entry.text,
                streaming: message.streaming,
                updatedAt: message.updatedAt,
                turnId: message.turnId,
                ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
              }
            : entry
        )
      : [...thread.messages, message]

    return {
      ...nextBase,
      threads: updateThread(nextBase.threads, payload.threadId, {
        messages: messages.slice(-MAX_THREAD_MESSAGES),
        updatedAt: event.occurredAt,
      }),
    }
  })
}

function handleThreadSessionSetEvent(nextBase: OrchestrationReadModel, event: OrchestrationEvent) {
  return Effect.gen(function* () {
    const payload = yield* decodeForEvent(
      ThreadSessionSetPayload,
      event.payload,
      event.type,
      'payload'
    )
    const thread = findThread(nextBase, payload.threadId)
    if (!thread) {
      return nextBase
    }

    const session: OrchestrationSession = yield* decodeForEvent(
      OrchestrationSession,
      payload.session,
      event.type,
      'session'
    )

    return {
      ...nextBase,
      threads: updateThread(nextBase.threads, payload.threadId, {
        session,
        latestTurn:
          session.status === 'running' && session.activeTurnId !== null
            ? {
                turnId: session.activeTurnId,
                state: 'running',
                requestedAt:
                  thread.latestTurn?.turnId === session.activeTurnId
                    ? thread.latestTurn.requestedAt
                    : session.updatedAt,
                startedAt:
                  thread.latestTurn?.turnId === session.activeTurnId
                    ? (thread.latestTurn.startedAt ?? session.updatedAt)
                    : session.updatedAt,
                completedAt: null,
                assistantMessageId:
                  thread.latestTurn?.turnId === session.activeTurnId
                    ? thread.latestTurn.assistantMessageId
                    : null,
              }
            : thread.latestTurn,
        updatedAt: event.occurredAt,
      }),
    }
  })
}

function handleThreadProposedPlanUpsertedEvent(
  nextBase: OrchestrationReadModel,
  event: OrchestrationEvent
) {
  return Effect.gen(function* () {
    const payload = yield* decodeForEvent(
      ThreadProposedPlanUpsertedPayload,
      event.payload,
      event.type,
      'payload'
    )
    const thread = findThread(nextBase, payload.threadId)
    if (!thread) {
      return nextBase
    }

    const proposedPlans = [
      ...thread.proposedPlans.filter(entry => entry.id !== payload.proposedPlan.id),
      payload.proposedPlan,
    ]
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      )
      .slice(-200)

    return {
      ...nextBase,
      threads: updateThread(nextBase.threads, payload.threadId, {
        proposedPlans,
        updatedAt: event.occurredAt,
      }),
    }
  })
}

function handleThreadTurnDiffCompletedEvent(
  nextBase: OrchestrationReadModel,
  event: OrchestrationEvent
) {
  return Effect.gen(function* () {
    const payload = yield* decodeForEvent(
      ThreadTurnDiffCompletedPayload,
      event.payload,
      event.type,
      'payload'
    )
    const thread = findThread(nextBase, payload.threadId)
    if (!thread) {
      return nextBase
    }

    const checkpoint = yield* decodeForEvent(
      OrchestrationCheckpointSummary,
      {
        turnId: payload.turnId,
        checkpointTurnCount: payload.checkpointTurnCount,
        checkpointRef: payload.checkpointRef,
        status: payload.status,
        files: payload.files,
        assistantMessageId: payload.assistantMessageId,
        completedAt: payload.completedAt,
      },
      event.type,
      'checkpoint'
    )

    const existing = thread.checkpoints.find(entry => entry.turnId === checkpoint.turnId)
    if (existing && existing.status !== 'missing' && checkpoint.status === 'missing') {
      return nextBase
    }

    const checkpoints = [
      ...thread.checkpoints.filter(entry => entry.turnId !== checkpoint.turnId),
      checkpoint,
    ]
      .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
      .slice(-MAX_THREAD_CHECKPOINTS)

    return {
      ...nextBase,
      threads: updateThread(nextBase.threads, payload.threadId, {
        checkpoints,
        latestTurn: {
          turnId: payload.turnId,
          state: checkpointStatusToLatestTurnState(payload.status),
          requestedAt:
            thread.latestTurn?.turnId === payload.turnId
              ? thread.latestTurn.requestedAt
              : payload.completedAt,
          startedAt:
            thread.latestTurn?.turnId === payload.turnId
              ? (thread.latestTurn.startedAt ?? payload.completedAt)
              : payload.completedAt,
          completedAt: payload.completedAt,
          assistantMessageId: payload.assistantMessageId,
        },
        updatedAt: event.occurredAt,
      }),
    }
  })
}

function handleThreadRevertedEvent(nextBase: OrchestrationReadModel, event: OrchestrationEvent) {
  return decodeForEvent(ThreadRevertedPayload, event.payload, event.type, 'payload').pipe(
    Effect.map(payload => {
      const thread = findThread(nextBase, payload.threadId)
      if (!thread) {
        return nextBase
      }

      const checkpoints = thread.checkpoints
        .filter(entry => entry.checkpointTurnCount <= payload.turnCount)
        .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
        .slice(-MAX_THREAD_CHECKPOINTS)
      const retainedTurnIds = new Set(checkpoints.map(checkpoint => checkpoint.turnId))
      const messages = retainThreadMessagesAfterRevert(
        thread.messages,
        retainedTurnIds,
        payload.turnCount
      ).slice(-MAX_THREAD_MESSAGES)
      const proposedPlans = retainThreadProposedPlansAfterRevert(
        thread.proposedPlans,
        retainedTurnIds
      ).slice(-200)
      const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds)

      const latestCheckpoint = checkpoints.at(-1) ?? null
      const latestTurn =
        latestCheckpoint === null
          ? null
          : {
              turnId: latestCheckpoint.turnId,
              state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
              requestedAt: latestCheckpoint.completedAt,
              startedAt: latestCheckpoint.completedAt,
              completedAt: latestCheckpoint.completedAt,
              assistantMessageId: latestCheckpoint.assistantMessageId,
            }

      return {
        ...nextBase,
        threads: updateThread(nextBase.threads, payload.threadId, {
          checkpoints,
          messages,
          proposedPlans,
          activities,
          latestTurn,
          updatedAt: event.occurredAt,
        }),
      }
    })
  )
}

function handleThreadActivityAppendedEvent(
  nextBase: OrchestrationReadModel,
  event: OrchestrationEvent
) {
  return decodeForEvent(ThreadActivityAppendedPayload, event.payload, event.type, 'payload').pipe(
    Effect.map(payload => {
      const thread = findThread(nextBase, payload.threadId)
      if (!thread) {
        return nextBase
      }

      const activities = [
        ...thread.activities.filter(entry => entry.id !== payload.activity.id),
        payload.activity,
      ]
        .toSorted(compareThreadActivities)
        .slice(-500)

      return {
        ...nextBase,
        threads: updateThread(nextBase.threads, payload.threadId, {
          activities,
          updatedAt: event.occurredAt,
        }),
      }
    })
  )
}

export function handleThreadEvent(nextBase: OrchestrationReadModel, event: OrchestrationEvent) {
  switch (event.type) {
    case 'thread.created':
      return handleThreadCreatedEvent(nextBase, event)
    case 'thread.deleted':
      return handleThreadDeletedEvent(nextBase, event)
    case 'thread.archived':
      return handleThreadArchivedEvent(nextBase, event)
    case 'thread.unarchived':
      return handleThreadUnarchivedEvent(nextBase, event)
    case 'thread.meta-updated':
      return handleThreadMetaUpdatedEvent(nextBase, event)
    case 'thread.runtime-mode-set':
      return handleThreadRuntimeModeSetEvent(nextBase, event)
    case 'thread.interaction-mode-set':
      return handleThreadInteractionModeSetEvent(nextBase, event)
    case 'thread.message-sent':
      return handleThreadMessageSentEvent(nextBase, event)
    case 'thread.session-set':
      return handleThreadSessionSetEvent(nextBase, event)
    case 'thread.proposed-plan-upserted':
      return handleThreadProposedPlanUpsertedEvent(nextBase, event)
    case 'thread.turn-diff-completed':
      return handleThreadTurnDiffCompletedEvent(nextBase, event)
    case 'thread.reverted':
      return handleThreadRevertedEvent(nextBase, event)
    case 'thread.activity-appended':
      return handleThreadActivityAppendedEvent(nextBase, event)
    default:
      return undefined
  }
}
