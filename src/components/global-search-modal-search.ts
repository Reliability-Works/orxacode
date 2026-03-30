import type { ProjectListItem } from '@shared/ipc'
import { getPersistedCodexState } from '../hooks/codex-session-storage'
import { getPersistedClaudeChatState } from '../hooks/claude-chat-session-storage'
import { buildWorkspaceSessionMetadataKey } from '../lib/workspace-session-metadata'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'

export type SearchResult = {
  sessionID: string
  directory: string
  sessionTitle: string
  workspaceLabel: string
  provider: string
  matches: Array<{
    type: 'title' | 'message'
    messageId?: string
    role?: string
    snippet: string
    timestamp?: number
  }>
}

type SessionEntry = {
  id: string
  title?: string
  slug: string
}

function extractTextFromOpencodeParts(
  parts: Array<{ type?: string; text?: string; content?: string }>
): string {
  return parts
    .filter(part => part.type === 'text' || part.type === 'markdown')
    .map(part => part.text ?? part.content ?? '')
    .join(' ')
}

function highlightSnippet(text: string, query: string, maxLen = 120): string {
  const lower = text.toLowerCase()
  const qLower = query.toLowerCase()
  const idx = lower.indexOf(qLower)
  if (idx === -1) return text.slice(0, maxLen)
  const start = Math.max(0, idx - 40)
  const end = Math.min(text.length, idx + query.length + 80)
  let snippet = text.slice(start, end)
  if (start > 0) snippet = `...${snippet}`
  if (end < text.length) snippet = `${snippet}...`
  return snippet
}

function searchCodexMessages(sessionKey: string, query: string, matches: SearchResult['matches']) {
  const persisted = getPersistedCodexState(sessionKey)
  for (const msg of persisted.messages) {
    if (msg.kind === 'message' && msg.content?.toLowerCase().includes(query)) {
      matches.push({
        type: 'message',
        messageId: msg.id,
        role: msg.role,
        snippet: highlightSnippet(msg.content, query),
        timestamp: msg.timestamp,
      })
    }
  }
}

function searchClaudeMessages(
  sessionKey: string,
  query: string,
  matches: SearchResult['matches']
) {
  const persisted = getPersistedClaudeChatState(sessionKey)
  for (const msg of persisted.messages) {
    if (msg.kind === 'message' && msg.content?.toLowerCase().includes(query)) {
      matches.push({
        type: 'message',
        messageId: msg.id,
        role: msg.role,
        snippet: highlightSnippet(msg.content, query),
        timestamp: msg.timestamp,
      })
    }
  }
}

function searchOpencodeMessages(
  directory: string,
  sessionID: string,
  query: string,
  matches: SearchResult['matches']
) {
  const state = useUnifiedRuntimeStore.getState()
  const opcodeKey = `opencode::${directory}::${sessionID}`
  const runtime = state.opencodeSessions[opcodeKey]
  if (!runtime?.messages) {
    return
  }
  for (const bundle of runtime.messages) {
    const text = extractTextFromOpencodeParts(
      bundle.parts as Array<{ type?: string; text?: string; content?: string }>
    )
    if (text.toLowerCase().includes(query)) {
      matches.push({
        type: 'message',
        messageId: bundle.info.id,
        role: (bundle.info as { role?: string }).role ?? 'unknown',
        snippet: highlightSnippet(text, query),
        timestamp: bundle.info.time?.created
          ? new Date(bundle.info.time.created).getTime()
          : undefined,
      })
    }
  }
}

export function searchGlobalSessions(
  projects: ProjectListItem[],
  projectSessions: Record<string, SessionEntry[]>,
  projectLabelMap: Record<string, string>,
  getSessionTitle: (sessionID: string, directory?: string, fallbackTitle?: string) => string | undefined,
  getSessionType: (sessionID: string, directory?: string) => string | undefined,
  searchQuery: string
): SearchResult[] {
  if (!searchQuery.trim()) {
    return []
  }

  const q = searchQuery.toLowerCase().trim()
  const found: SearchResult[] = []

  for (const project of projects) {
    const directory = project.worktree
    const sessions = projectSessions[directory] ?? []
    const workspaceLabel = projectLabelMap[directory] ?? directory

    for (const session of sessions) {
      const sessionTitle =
        getSessionTitle(session.id, directory, session.title ?? session.slug) ??
        session.title ??
        session.slug
      const sessionType = getSessionType(session.id, directory)
      const matches: SearchResult['matches'] = []

      if (sessionTitle.toLowerCase().includes(q)) {
        matches.push({ type: 'title', snippet: sessionTitle })
      }

      const sessionKey = buildWorkspaceSessionMetadataKey(directory, session.id)
      if (sessionType === 'codex') {
        searchCodexMessages(sessionKey, q, matches)
      } else if (sessionType === 'claude-chat') {
        searchClaudeMessages(sessionKey, q, matches)
      } else if (sessionType === 'standalone' || sessionType === 'opencode') {
        searchOpencodeMessages(directory, session.id, q, matches)
      }

      if (matches.length > 0) {
        found.push({
          sessionID: session.id,
          directory,
          sessionTitle,
          workspaceLabel,
          provider: sessionType ?? 'unknown',
          matches: matches.slice(0, 5),
        })
      }
    }
  }

  return found
}
