import { describe, expect, it } from 'vitest'
import { getSessionContextActions, resolveSessionCopyIdentifier } from './session-context-menu'

describe('session-context-menu', () => {
  it('limits canvas sessions to archive and rename', () => {
    expect(getSessionContextActions('canvas')).toEqual(['archive', 'rename'])
  })

  it('keeps worktree creation only for standalone sessions', () => {
    expect(getSessionContextActions('standalone')).toContain('create_worktree')
    expect(getSessionContextActions('codex')).not.toContain('create_worktree')
    expect(getSessionContextActions('claude-chat')).not.toContain('create_worktree')
  })

  it('copies provider-specific codex thread ids when available', () => {
    expect(
      resolveSessionCopyIdentifier({
        sessionType: 'codex',
        workspaceSessionID: 'workspace-session',
        codexThreadID: 'codex-thread',
      })
    ).toEqual({
      value: 'codex-thread',
      label: 'Codex thread ID',
    })
  })

  it('copies provider-specific claude chat thread ids when available', () => {
    expect(
      resolveSessionCopyIdentifier({
        sessionType: 'claude-chat',
        workspaceSessionID: 'workspace-session',
        claudeChatProviderThreadId: 'claude-thread',
      })
    ).toEqual({
      value: 'claude-thread',
      label: 'Claude thread ID',
    })
  })

  it('falls back to the workspace session id otherwise', () => {
    expect(
      resolveSessionCopyIdentifier({
        sessionType: 'standalone',
        workspaceSessionID: 'workspace-session',
      })
    ).toEqual({
      value: 'workspace-session',
      label: 'Session ID',
    })
  })
})
