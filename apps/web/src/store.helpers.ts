/**
 * Pure helper functions and types for the app store.
 *
 * Extracted from store.ts to keep per-file line counts within lint limits.
 * Nothing here has side-effects; all functions are pure state transformations
 * or simple mappings.
 */
import {
  type OrchestrationSession,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestrationCheckpointSummary,
  type OrchestrationThread,
  type OrchestrationSessionStatus,
  type ProviderKind,
  ProjectId,
} from '@orxa-code/contracts'
import { resolveModelSlugForProvider } from '@orxa-code/shared/model'
import {
  compareActivitiesBySequenceThenCreatedAt,
  retainThreadMessageIdsAfterRevert,
} from '@orxa-code/shared/projectionRevert'
import { getActiveEnvironmentHttpOrigin } from './environmentRuntimeState'
import { type ChatMessage, type Project, type Thread } from './types'

// ── State ────────────────────────────────────────────────────────────

export interface AppState {
  activeEnvironmentId: string | null
  projects: Project[]
  threads: Thread[]
  bootstrapComplete: boolean
}

export const initialState: AppState = {
  activeEnvironmentId: null,
  projects: [],
  threads: [],
  bootstrapComplete: false,
}

// ── Constants ────────────────────────────────────────────────────────

export const MAX_THREAD_MESSAGES = 2_000
export const MAX_THREAD_CHECKPOINTS = 500
export const MAX_THREAD_PROPOSED_PLANS = 200
export const MAX_THREAD_ACTIVITIES = 500

// ── Utility helpers ──────────────────────────────────────────────────

export function updateThread(
  threads: Thread[],
  threadId: string,
  updater: (t: Thread) => Thread
): Thread[] {
  let changed = false
  const next = threads.map(t => {
    if (t.id !== threadId) return t
    const updated = updater(t)
    if (updated !== t) changed = true
    return updated
  })
  return changed ? next : threads
}

export function updateProject(
  projects: Project[],
  projectId: Project['id'],
  updater: (project: Project) => Project
): Project[] {
  let changed = false
  const next = projects.map(project => {
    if (project.id !== projectId) {
      return project
    }
    const updated = updater(project)
    if (updated !== project) {
      changed = true
    }
    return updated
  })
  return changed ? next : projects
}

export function normalizeModelSelection<
  T extends { provider: 'codex' | 'claudeAgent' | 'opencode'; model: string },
>(selection: T): T {
  return {
    ...selection,
    model: resolveModelSlugForProvider(selection.provider, selection.model),
  }
}

export function mapProjectScripts(
  scripts: ReadonlyArray<Project['scripts'][number]>
): Project['scripts'] {
  return scripts.map(script => ({ ...script }))
}

export function toLegacySessionStatus(
  status: OrchestrationSessionStatus
): 'connecting' | 'ready' | 'running' | 'error' | 'closed' {
  switch (status) {
    case 'starting':
      return 'connecting'
    case 'running':
      return 'running'
    case 'error':
      return 'error'
    case 'ready':
    case 'interrupted':
      return 'ready'
    case 'idle':
    case 'stopped':
      return 'closed'
  }
}

export function toLegacyProvider(providerName: string | null): ProviderKind {
  if (providerName === 'codex' || providerName === 'claudeAgent' || providerName === 'opencode') {
    return providerName
  }
  return 'codex'
}

function resolveWsHttpOrigin(): string {
  if (typeof window === 'undefined') return ''
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined
  const wsCandidate = typeof envWsUrl === 'string' && envWsUrl.length > 0 ? envWsUrl : null
  if (!wsCandidate) {
    return getActiveEnvironmentHttpOrigin() ?? window.location.origin
  }
  try {
    const wsUrl = new URL(wsCandidate)
    const protocol =
      wsUrl.protocol === 'wss:' ? 'https:' : wsUrl.protocol === 'ws:' ? 'http:' : wsUrl.protocol
    return `${protocol}//${wsUrl.host}`
  } catch {
    return getActiveEnvironmentHttpOrigin() ?? window.location.origin
  }
}

function toAttachmentPreviewUrl(rawUrl: string): string {
  if (rawUrl.startsWith('/')) {
    return `${resolveWsHttpOrigin()}${rawUrl}`
  }
  return rawUrl
}

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`
}

export function mapSession(session: OrchestrationSession): Thread['session'] {
  return {
    provider: toLegacyProvider(session.providerName),
    status: toLegacySessionStatus(session.status),
    orchestrationStatus: session.status,
    providerSessionId: session.providerSessionId ?? null,
    providerThreadId: session.providerThreadId ?? null,
    activeTurnId: session.activeTurnId ?? undefined,
    createdAt: session.updatedAt,
    updatedAt: session.updatedAt,
    ...(session.lastError ? { lastError: session.lastError } : {}),
  }
}

export function mapMessage(message: OrchestrationMessage): ChatMessage {
  const attachments = message.attachments?.map(attachment => ({
    type: 'image' as const,
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
  }))

  return {
    id: message.id,
    role: message.role,
    text: message.text,
    turnId: message.turnId,
    createdAt: message.createdAt,
    streaming: message.streaming,
    ...(message.streaming ? {} : { completedAt: message.updatedAt }),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  }
}

export function mapProposedPlan(
  proposedPlan: OrchestrationProposedPlan
): Thread['proposedPlans'][number] {
  return {
    id: proposedPlan.id,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
  }
}

export function mapTurnDiffSummary(
  checkpoint: OrchestrationCheckpointSummary
): Thread['turnDiffSummaries'][number] {
  return {
    turnId: checkpoint.turnId,
    completedAt: checkpoint.completedAt,
    status: checkpoint.status,
    assistantMessageId: checkpoint.assistantMessageId ?? undefined,
    checkpointTurnCount: checkpoint.checkpointTurnCount,
    checkpointRef: checkpoint.checkpointRef,
    files: checkpoint.files.map(file => ({ ...file })),
  }
}

export function mapThread(thread: OrchestrationThread, environmentId?: string): Thread {
  return {
    id: thread.id,
    ...(environmentId ? { environmentId } : {}),
    codexThreadId: null,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: normalizeModelSelection(thread.modelSelection),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    session: thread.session ? mapSession(thread.session) : null,
    messages: thread.messages.map(mapMessage),
    proposedPlans: thread.proposedPlans.map(mapProposedPlan),
    error: thread.session?.lastError ?? null,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    pendingSourceProposedPlan: thread.latestTurn?.sourceProposedPlan,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    parentBranch: thread.parentBranch ?? null,
    gitRoot: thread.gitRoot,
    handoff: thread.handoff,
    parentLink: thread.parentLink,
    turnDiffSummaries: thread.checkpoints.map(mapTurnDiffSummary),
    activities: thread.activities.map(activity => ({ ...activity })),
  }
}

export function mapProject(
  project: {
    id: string
    title: string
    workspaceRoot: string
    defaultModelSelection?: { provider: 'codex' | 'claudeAgent' | 'opencode'; model: string } | null
    scripts: ReadonlyArray<Project['scripts'][number]>
    createdAt: string
    updatedAt: string
    deletedAt: string | null
  },
  environmentId?: string
): Project {
  return {
    id: ProjectId.makeUnsafe(project.id),
    ...(environmentId ? { environmentId } : {}),
    name: project.title,
    cwd: project.workspaceRoot,
    defaultModelSelection: project.defaultModelSelection
      ? normalizeModelSelection(project.defaultModelSelection)
      : null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    scripts: mapProjectScripts(project.scripts),
  }
}

export function checkpointStatusToLatestTurnState(
  status: 'ready' | 'missing' | 'error'
): 'completed' | 'interrupted' | 'error' {
  if (status === 'error') {
    return 'error'
  }
  if (status === 'missing') {
    return 'interrupted'
  }
  return 'completed'
}

export const compareActivities: (
  left: Thread['activities'][number],
  right: Thread['activities'][number]
) => number = compareActivitiesBySequenceThenCreatedAt

export function buildLatestTurn(params: {
  previous: Thread['latestTurn']
  turnId: NonNullable<Thread['latestTurn']>['turnId']
  state: NonNullable<Thread['latestTurn']>['state']
  requestedAt: string
  startedAt: string | null
  completedAt: string | null
  assistantMessageId: NonNullable<Thread['latestTurn']>['assistantMessageId']
  sourceProposedPlan?: Thread['pendingSourceProposedPlan']
}): NonNullable<Thread['latestTurn']> {
  const resolvedPlan =
    params.previous?.turnId === params.turnId
      ? params.previous.sourceProposedPlan
      : params.sourceProposedPlan
  return {
    turnId: params.turnId,
    state: params.state,
    requestedAt: params.requestedAt,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    assistantMessageId: params.assistantMessageId,
    ...(resolvedPlan ? { sourceProposedPlan: resolvedPlan } : {}),
  }
}

export function rebindTurnDiffSummariesForAssistantMessage(
  turnDiffSummaries: ReadonlyArray<Thread['turnDiffSummaries'][number]>,
  turnId: Thread['turnDiffSummaries'][number]['turnId'],
  assistantMessageId: NonNullable<Thread['latestTurn']>['assistantMessageId']
): Thread['turnDiffSummaries'] {
  let changed = false
  const nextSummaries = turnDiffSummaries.map(summary => {
    if (summary.turnId !== turnId || summary.assistantMessageId === assistantMessageId) {
      return summary
    }
    changed = true
    return {
      ...summary,
      assistantMessageId: assistantMessageId ?? undefined,
    }
  })
  return changed ? nextSummaries : [...turnDiffSummaries]
}

export function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<ChatMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number
): ChatMessage[] {
  const retainedMessageIds = retainThreadMessageIdsAfterRevert(messages, retainedTurnIds, turnCount)
  return messages.filter(message => retainedMessageIds.has(message.id))
}

export function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<Thread['activities'][number]>,
  retainedTurnIds: ReadonlySet<string>
): Thread['activities'] {
  return activities.filter(
    activity => activity.turnId === null || retainedTurnIds.has(activity.turnId)
  )
}

export function retainThreadProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<Thread['proposedPlans'][number]>,
  retainedTurnIds: ReadonlySet<string>
): Thread['proposedPlans'] {
  return proposedPlans.filter(
    proposedPlan => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId)
  )
}

export function mergeExistingMessage(entry: ChatMessage, incoming: ChatMessage): ChatMessage {
  return {
    ...entry,
    text: incoming.streaming
      ? `${entry.text}${incoming.text}`
      : incoming.text.length > 0
        ? incoming.text
        : entry.text,
    streaming: incoming.streaming,
    ...(incoming.turnId !== undefined ? { turnId: incoming.turnId } : {}),
    ...(incoming.streaming
      ? entry.completedAt !== undefined
        ? { completedAt: entry.completedAt }
        : {}
      : incoming.completedAt !== undefined
        ? { completedAt: incoming.completedAt }
        : {}),
    ...(incoming.attachments !== undefined ? { attachments: incoming.attachments } : {}),
  }
}

export function resolveLatestTurnStateForMessage(
  streaming: boolean,
  prevState: NonNullable<Thread['latestTurn']>['state'] | undefined
): NonNullable<Thread['latestTurn']>['state'] {
  if (streaming) return 'running'
  if (prevState === 'interrupted') return 'interrupted'
  if (prevState === 'error') return 'error'
  return 'completed'
}
