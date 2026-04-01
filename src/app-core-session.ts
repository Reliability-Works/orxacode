import type { Dispatch, SetStateAction } from 'react'
import type { ClaudeChatHealthStatus, SessionPermissionMode } from '@shared/ipc'
import type { SessionType } from '~/types/canvas'
import { buildWorkspaceSessionMetadataKey } from './lib/workspace-session-metadata'
import {
  createBoundLocalProviderSessionRecord,
  createLocalProviderSessionRecord,
  isLocalProviderSessionType,
  type SyntheticSessionType,
} from './lib/local-provider-sessions'

type LocalProviderSessionRecord = ReturnType<typeof createLocalProviderSessionRecord>

type CreateSessionContext = {
  activeProjectDir: string | undefined
  appPermissionMode: SessionPermissionMode
  availableAgentNames: Set<string>
  clearPendingSession: () => void
  createWorkspaceSession: (
    directory: string | undefined,
    initialPrompt: string | undefined,
    options: {
      permissionMode: SessionPermissionMode
      selectedAgent: string | undefined
      selectedModelPayload?: { providerID: string; modelID: string }
      selectedVariant?: string
      availableAgentNames: Set<string>
    }
  ) => Promise<string | undefined>
  describeClaudeHealthFailure: (sessionLabel: string, health: ClaudeChatHealthStatus) => string
  findReusableDraftSession: (
    directory: string,
    type: SyntheticSessionType
  ) => LocalProviderSessionRecord | undefined
  markSessionUsed: (sessionID: string) => void
  registerLocalProviderSession: (record: LocalProviderSessionRecord) => LocalProviderSessionRecord
  selectProject: (directory: string) => Promise<void>
  selectedAgent: string | undefined
  selectedModelPayload?: { providerID: string; modelID: string }
  selectedVariant?: string
  setActiveProjectDir: (directory: string | undefined) => void
  setActiveSessionID: (sessionID: string | undefined) => void
  setManualSessionTitles: Dispatch<SetStateAction<Record<string, boolean>>>
  setSessionTitles: Dispatch<SetStateAction<Record<string, string>>>
  setSessionTypes: Dispatch<SetStateAction<Record<string, SessionType>>>
  setSidebarMode: (mode: 'projects' | 'kanban' | 'skills') => void
  setStatusLine: (value: string) => void
}

const STRUCTURED_SESSION_LABELS: Partial<Record<SessionType, string>> = {
  claude: 'Claude Code (Terminal)',
  'claude-chat': 'Claude Code (Chat)',
  codex: 'Codex Session',
  opencode: 'OpenCode Session',
}

type SessionCreationIntent = {
  initialPrompt?: string
  sessionLabel: string
  sessionType: SessionType
  targetDirectory: string
  titleMap: Record<string, string>
}

type LocalSessionCreationIntent = SessionCreationIntent & {
  sessionType: SyntheticSessionType
}

function shouldCreateDraftSession(intent: SessionCreationIntent) {
  return (
    intent.sessionType === 'opencode' ||
    intent.sessionType === 'codex' ||
    intent.sessionType === 'claude-chat'
  )
}

function resolveSessionCreationIntent(
  activeProjectDir: string | undefined,
  directory?: string,
  sessionTypeOrPrompt?: SessionType | string
): SessionCreationIntent | null {
  const isSessionType =
    sessionTypeOrPrompt === 'opencode' ||
    sessionTypeOrPrompt === 'canvas' ||
    sessionTypeOrPrompt === 'claude' ||
    sessionTypeOrPrompt === 'claude-chat' ||
    sessionTypeOrPrompt === 'codex'
  const sessionType: SessionType = isSessionType ? (sessionTypeOrPrompt as SessionType) : 'opencode'
  const targetDirectory = directory ?? activeProjectDir
  if (!targetDirectory) {
    return null
  }
  return {
    initialPrompt: isSessionType ? undefined : sessionTypeOrPrompt,
    sessionLabel: STRUCTURED_SESSION_LABELS[sessionType] ?? 'Session',
    sessionType,
    targetDirectory,
    titleMap: {
      claude: 'Claude Code (Terminal)',
      'claude-chat': 'Claude Code (Chat)',
      canvas: 'Canvas',
      codex: 'Codex Session',
      opencode: 'OpenCode Session',
    },
  }
}

async function verifyClaudeSessionHealth(
  intent: SessionCreationIntent,
  describeClaudeHealthFailure: (sessionLabel: string, health: ClaudeChatHealthStatus) => string
) {
  if (intent.sessionType !== 'claude' && intent.sessionType !== 'claude-chat') {
    return
  }
  const health = await window.orxa.claudeChat.health()
  if (!health.available || health.authenticated === false) {
    throw new Error(describeClaudeHealthFailure(intent.sessionLabel, health))
  }
}

function applyStructuredSessionMetadata(
  sessionKey: string,
  sessionType: SessionType,
  sessionTitle: string | undefined,
  actions: {
    setManualSessionTitles: Dispatch<SetStateAction<Record<string, boolean>>>
    setSessionTitles: Dispatch<SetStateAction<Record<string, string>>>
    setSessionTypes: Dispatch<SetStateAction<Record<string, SessionType>>>
  }
) {
  const { setManualSessionTitles, setSessionTitles, setSessionTypes } = actions
  setSessionTypes(prev => ({ ...prev, [sessionKey]: sessionType }))
  if (sessionTitle) {
    setSessionTitles(prev => ({ ...prev, [sessionKey]: sessionTitle }))
  }
  setManualSessionTitles(prev => {
    if (!(sessionKey in prev)) {
      return prev
    }
    const next = { ...prev }
    delete next[sessionKey]
    return next
  })
}

async function createLocalProviderSession(
  intent: LocalSessionCreationIntent,
  options: { draft: boolean },
  context: Pick<
    CreateSessionContext,
    | 'activeProjectDir'
    | 'clearPendingSession'
    | 'findReusableDraftSession'
    | 'markSessionUsed'
    | 'registerLocalProviderSession'
    | 'selectProject'
    | 'setActiveProjectDir'
    | 'setActiveSessionID'
    | 'setManualSessionTitles'
    | 'setSessionTitles'
    | 'setSessionTypes'
    | 'setSidebarMode'
    | 'setStatusLine'
  >
) {
  const {
    activeProjectDir,
    clearPendingSession,
    findReusableDraftSession,
    markSessionUsed,
    registerLocalProviderSession,
    selectProject,
    setActiveProjectDir,
    setActiveSessionID,
    setManualSessionTitles,
    setSessionTitles,
    setSessionTypes,
    setSidebarMode,
    setStatusLine,
  } = context

  if (activeProjectDir !== intent.targetDirectory) {
    await selectProject(intent.targetDirectory)
  }

  const reusableDraft =
    options.draft && intent.sessionType === 'opencode'
      ? findReusableDraftSession(intent.targetDirectory, intent.sessionType)
      : undefined
  if (reusableDraft) {
    const scopedSessionKey = buildWorkspaceSessionMetadataKey(
      intent.targetDirectory,
      reusableDraft.sessionID
    )
    applyStructuredSessionMetadata(scopedSessionKey, intent.sessionType, reusableDraft.title, {
      setManualSessionTitles,
      setSessionTitles,
      setSessionTypes,
    })
    setSidebarMode('projects')
    setActiveProjectDir(intent.targetDirectory)
    setActiveSessionID(reusableDraft.sessionID)
    clearPendingSession()
    setStatusLine('Session created')
    return
  }

  const record = registerLocalProviderSession(
    createLocalProviderSessionRecord(
      intent.targetDirectory,
      intent.sessionType,
      intent.titleMap[intent.sessionType] ?? intent.sessionLabel,
      { draft: options.draft }
    )
  )
  const scopedSessionKey = buildWorkspaceSessionMetadataKey(intent.targetDirectory, record.sessionID)
  applyStructuredSessionMetadata(scopedSessionKey, intent.sessionType, record.title, {
    setManualSessionTitles,
    setSessionTitles,
    setSessionTypes,
  })
  setSidebarMode('projects')
  setActiveProjectDir(intent.targetDirectory)
  setActiveSessionID(record.sessionID)
  clearPendingSession()
  if (!options.draft) {
    markSessionUsed(record.sessionID)
  }
  setStatusLine('Session created')
}

type BoundLocalProviderSessionIntent = {
  directory: string
  sessionID: string
  sessionType: SyntheticSessionType
  title: string
}

export async function openBoundLocalProviderSessionAction(
  context: Pick<
    CreateSessionContext,
    | 'activeProjectDir'
    | 'clearPendingSession'
    | 'markSessionUsed'
    | 'registerLocalProviderSession'
    | 'selectProject'
    | 'setActiveProjectDir'
    | 'setActiveSessionID'
    | 'setManualSessionTitles'
    | 'setSessionTitles'
    | 'setSessionTypes'
    | 'setSidebarMode'
    | 'setStatusLine'
  >,
  intent: BoundLocalProviderSessionIntent
) {
  if (context.activeProjectDir !== intent.directory) {
    await context.selectProject(intent.directory)
  }

  const record = context.registerLocalProviderSession(
    createBoundLocalProviderSessionRecord(
      intent.directory,
      intent.sessionType,
      intent.sessionID,
      intent.title,
      { draft: false }
    )
  )
  const scopedSessionKey = buildWorkspaceSessionMetadataKey(intent.directory, record.sessionID)
  applyStructuredSessionMetadata(scopedSessionKey, intent.sessionType, record.title, {
    setManualSessionTitles: context.setManualSessionTitles,
    setSessionTitles: context.setSessionTitles,
    setSessionTypes: context.setSessionTypes,
  })
  context.setSidebarMode('projects')
  context.setActiveProjectDir(intent.directory)
  context.setActiveSessionID(record.sessionID)
  context.clearPendingSession()
  context.markSessionUsed(record.sessionID)
  context.setStatusLine('Session opened')
}

export async function createSessionAction(
  context: CreateSessionContext,
  directory?: string,
  sessionTypeOrPrompt?: SessionType | string
) {
  const {
    activeProjectDir,
    appPermissionMode,
    availableAgentNames,
    clearPendingSession,
    createWorkspaceSession,
    describeClaudeHealthFailure,
    findReusableDraftSession,
    markSessionUsed,
    registerLocalProviderSession,
    selectProject,
    selectedAgent,
    selectedModelPayload,
    selectedVariant,
    setActiveProjectDir,
    setActiveSessionID,
    setManualSessionTitles,
    setSessionTitles,
    setSessionTypes,
    setSidebarMode,
    setStatusLine,
  } = context

  const intent = resolveSessionCreationIntent(activeProjectDir, directory, sessionTypeOrPrompt)
  if (!intent) {
    return
  }

  try {
    await verifyClaudeSessionHealth(intent, describeClaudeHealthFailure)
  } catch (error) {
    setStatusLine(error instanceof Error ? error.message : String(error))
    return
  }

  const shouldCreateSyntheticSession =
    (intent.sessionType === 'opencode' && !intent.initialPrompt) ||
    isLocalProviderSessionType(intent.sessionType)

  if (shouldCreateSyntheticSession) {
    await createLocalProviderSession(intent as LocalSessionCreationIntent, {
      draft: shouldCreateDraftSession(intent),
    }, {
      activeProjectDir,
      clearPendingSession,
      findReusableDraftSession,
      markSessionUsed,
      registerLocalProviderSession,
      selectProject,
      setActiveProjectDir,
      setActiveSessionID,
      setManualSessionTitles,
      setSessionTitles,
      setSessionTypes,
      setSidebarMode,
      setStatusLine,
    })
    return
  }

  const createdSessionId = await createWorkspaceSession(directory, intent.initialPrompt, {
    permissionMode: appPermissionMode,
    selectedAgent,
    selectedModelPayload,
    selectedVariant,
    availableAgentNames,
  })

  if (intent.sessionType !== 'opencode' && createdSessionId) {
    const scopedSessionKey = buildWorkspaceSessionMetadataKey(intent.targetDirectory, createdSessionId)
    applyStructuredSessionMetadata(
      scopedSessionKey,
      intent.sessionType,
      intent.titleMap[intent.sessionType],
      { setManualSessionTitles, setSessionTitles, setSessionTypes }
    )
    if (intent.sessionType === 'canvas') {
      // These surfaces do not send a first chat message, so an untouched session is still
      // intentionally "real" and should survive navigation.
      markSessionUsed(createdSessionId)
    }
  }
}
