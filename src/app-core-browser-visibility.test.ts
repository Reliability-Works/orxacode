import { describe, expect, it } from 'vitest'
import { shouldHideBrowserViewForPendingInput } from './app-core-browser-visibility'

describe('shouldHideBrowserViewForPendingInput', () => {
  it('returns true when provider-specific dock approval is present', () => {
    expect(
      shouldHideBrowserViewForPendingInput({
        pendingPermission: null,
        pendingQuestion: null,
        dockPendingPermission: { provider: 'claude-chat', requestId: 'approval-1' },
        dockPendingQuestion: null,
      })
    ).toBe(true)
  })

  it('returns false when no pending approvals or questions exist', () => {
    expect(
      shouldHideBrowserViewForPendingInput({
        pendingPermission: null,
        pendingQuestion: null,
        dockPendingPermission: null,
        dockPendingQuestion: null,
      })
    ).toBe(false)
  })

  it('returns true when provider-specific dock question is present', () => {
    expect(
      shouldHideBrowserViewForPendingInput({
        pendingPermission: null,
        pendingQuestion: null,
        dockPendingPermission: null,
        dockPendingQuestion: { provider: 'codex', requestId: 'question-1' },
      })
    ).toBe(true)
  })
})
