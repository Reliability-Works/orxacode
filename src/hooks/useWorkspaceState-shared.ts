import type { Event as OpencodeEvent } from '@opencode-ai/sdk/v2/client'
import type { ProjectBootstrap, SessionMessageBundle, SessionPermissionMode } from '@shared/ipc'
import { readPersistedValue } from '../lib/persistence'

export const PINNED_SESSIONS_KEY = 'orxa:pinnedSessions:v1'
export const EMPTY_WORKSPACE_SESSIONS_KEY = 'orxa:emptyWorkspaceSessions:v1'
export const EMPTY_MESSAGE_BUNDLES: SessionMessageBundle[] = []

export type SidebarMode = 'projects' | 'kanban' | 'skills'

export type ContextMenuState =
  | {
      kind: 'project'
      x: number
      y: number
      directory: string
      label: string
    }
  | {
      kind: 'session'
      x: number
      y: number
      directory: string
      sessionID: string
      title: string
    }
  | null

export type CreateSessionPromptOptions = {
  selectedAgent?: string
  selectedModelPayload?: { providerID: string; modelID: string }
  selectedVariant?: string
  permissionMode?: SessionPermissionMode
  availableAgentNames: Set<string>
}

export type SelectProjectOptions = {
  showLanding?: boolean
  sessionID?: string
}

export function deriveSessionTitleFromPrompt(prompt: string, maxLength = 56) {
  const cleaned = prompt
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s\-_:,.!?/]/gu, '')
    .trim()
  if (!cleaned) {
    return 'OpenCode Session'
  }
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3).trimEnd()}...` : cleaned
}

export function clampContextMenuPosition(x: number, y: number) {
  const menuWidth = 240
  const menuHeight = 220
  const padding = 8
  return {
    x: Math.max(padding, Math.min(x, window.innerWidth - menuWidth - padding)),
    y: Math.max(padding, Math.min(y, window.innerHeight - menuHeight - padding)),
  }
}

export async function loadOpencodeRuntimeSnapshot(directory: string, sessionID: string) {
  return window.orxa.opencode.getSessionRuntime(directory, sessionID)
}

export function readPersistedEmptySessions() {
  if (typeof window === 'undefined') {
    return new Map<string, string>()
  }
  try {
    const raw = readPersistedValue(EMPTY_WORKSPACE_SESSIONS_KEY)
    if (!raw) {
      return new Map<string, string>()
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') {
      return new Map<string, string>()
    }
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1].trim().length > 0
      )
    )
  } catch {
    return new Map<string, string>()
  }
}

export function resolveRecoveredOpencodeSessionStatus(
  runtimeStatus: ProjectBootstrap['sessionStatus'][string] | undefined,
  cachedStatus: ProjectBootstrap['sessionStatus'][string] | undefined
) {
  if (runtimeStatus) {
    return runtimeStatus
  }
  if (cachedStatus?.type === 'busy' || cachedStatus?.type === 'retry') {
    return { type: 'idle' } as ProjectBootstrap['sessionStatus'][string]
  }
  return cachedStatus ?? ({ type: 'idle' } as ProjectBootstrap['sessionStatus'][string])
}

export function extractEventSessionID(event: OpencodeEvent): string | undefined {
  const properties = event.properties as Record<string, unknown> | undefined
  if (!properties) {
    return undefined
  }
  if (typeof properties.sessionID === 'string') {
    return properties.sessionID
  }
  const info = properties.info
  if (
    info &&
    typeof info === 'object' &&
    typeof (info as { sessionID?: unknown }).sessionID === 'string'
  ) {
    return (info as { sessionID: string }).sessionID
  }
  const part = properties.part
  if (
    part &&
    typeof part === 'object' &&
    typeof (part as { sessionID?: unknown }).sessionID === 'string'
  ) {
    return (part as { sessionID: string }).sessionID
  }
  return undefined
}
