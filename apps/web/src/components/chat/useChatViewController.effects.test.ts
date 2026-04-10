import { describe, expect, it } from 'vitest'

import { deriveEnvMode, resolveComposerHighlightedItemId } from './useChatViewController.effects'

describe('resolveComposerHighlightedItemId', () => {
  const items = [{ id: 'first' }, { id: 'second' }]

  it('returns null when the composer menu is closed', () => {
    expect(resolveComposerHighlightedItemId(false, items, 'first')).toBeNull()
  })

  it('preserves the current highlight when it still exists', () => {
    expect(resolveComposerHighlightedItemId(true, items, 'second')).toBe('second')
  })

  it('falls back to the first command when the current highlight is stale', () => {
    expect(resolveComposerHighlightedItemId(true, items, 'missing')).toBe('first')
  })

  it('returns null when the menu is open with no items', () => {
    expect(resolveComposerHighlightedItemId(true, [], 'missing')).toBeNull()
  })
})

describe('deriveEnvMode', () => {
  it('uses worktree mode for an empty server thread when the draft env mode requests it', () => {
    expect(
      deriveEnvMode(
        {
          worktreePath: null,
          messages: [],
        },
        false,
        'worktree'
      )
    ).toBe('worktree')
  })

  it('falls back to local mode once a server thread already has messages', () => {
    expect(
      deriveEnvMode(
        {
          worktreePath: null,
          messages: [{}],
        },
        false,
        'worktree'
      )
    ).toBe('local')
  })
})
