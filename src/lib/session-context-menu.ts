import type { SessionType } from '../types/canvas'

export type SessionContextAction = 'archive' | 'copy_id' | 'rename'

export function getSessionContextActions(
  sessionType: SessionType | undefined
): SessionContextAction[] {
  switch (sessionType) {
    case 'canvas':
      return ['archive', 'rename']
    case 'codex':
    case 'claude-chat':
      return ['archive', 'copy_id', 'rename']
    case 'claude':
      return ['archive', 'rename']
    case 'opencode':
    default:
      return ['archive', 'copy_id', 'rename']
  }
}

type ResolveCopyIdInput = {
  sessionType: SessionType | undefined
  workspaceSessionID: string
  codexThreadID?: string | null
  claudeChatProviderThreadId?: string | null
}

export function resolveSessionCopyIdentifier(input: ResolveCopyIdInput) {
  if (input.sessionType === 'codex' && input.codexThreadID) {
    return {
      value: input.codexThreadID,
      label: 'Codex thread ID',
    }
  }

  if (input.sessionType === 'claude-chat' && input.claudeChatProviderThreadId) {
    return {
      value: input.claudeChatProviderThreadId,
      label: 'Claude thread ID',
    }
  }

  return {
    value: input.workspaceSessionID,
    label: 'Session ID',
  }
}
