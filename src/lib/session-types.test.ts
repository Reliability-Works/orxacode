import { describe, expect, it } from 'vitest'
import { isOpencodeRuntimeSession, isRemoteOpencodeSessionID } from './session-types'

describe('session archive/runtime routing', () => {
  it('treats upstream OpenCode session ids as remote runtime sessions', () => {
    expect(isRemoteOpencodeSessionID('ses_123')).toBe(true)
    expect(isOpencodeRuntimeSession('opencode', 'ses_123')).toBe(true)
    expect(isOpencodeRuntimeSession('canvas', 'ses_456')).toBe(true)
    expect(isOpencodeRuntimeSession(undefined, 'ses_789')).toBe(true)
  })

  it('keeps synthetic opencode ids out of the OpenCode runtime path', () => {
    expect(isRemoteOpencodeSessionID('opencode-mnepiv0a-a0997134')).toBe(false)
    expect(isOpencodeRuntimeSession('opencode', 'opencode-mnepiv0a-a0997134')).toBe(false)
  })

  it('keeps provider-local session types out of the OpenCode runtime path', () => {
    expect(isOpencodeRuntimeSession('claude-chat', 'claude-chat-mneplevj-97a6c3bc')).toBe(false)
    expect(isOpencodeRuntimeSession('codex', 'codex-mneplevj-97a6c3bc')).toBe(false)
    expect(isOpencodeRuntimeSession('claude', 'claude-mneplevj-97a6c3bc')).toBe(false)
  })
})
