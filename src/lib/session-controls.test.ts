import { describe, expect, it } from 'vitest'
import {
  buildClaudeRevertTargets,
  buildCodexCompactionState,
  buildSessionGuardrailState,
  finalizeSessionRevertTargets,
} from './session-controls'

describe('session-controls', () => {
  it('disables older revert targets when a later turn changed the same file', () => {
    const targets = finalizeSessionRevertTargets(
      [
        {
          id: 'old',
          label: 'First turn',
          timestamp: 10,
          files: [{ id: 'a', path: 'src/a.ts', type: 'modified' }],
        },
        {
          id: 'new',
          label: 'Second turn',
          timestamp: 20,
          files: [{ id: 'b', path: 'src/a.ts', type: 'modified' }],
        },
      ],
      [{ key: 'src/a.ts', path: 'src/a.ts', status: 'modified', added: 1, removed: 0, hasUnstaged: true, hasStaged: false, diffLines: [] }]
    )

    expect(targets[0]).toMatchObject({ id: 'new', canRevert: true })
    expect(targets[1]).toMatchObject({
      id: 'old',
      canRevert: false,
      disabledReason: 'A later turn also changed one or more of these files.',
    })
  })

  it('disables revert targets when files are staged', () => {
    const targets = buildClaudeRevertTargets(
      [
        { id: 'user-1', kind: 'message', role: 'user', content: 'update file', timestamp: 1 },
        {
          id: 'diff-1',
          kind: 'diff',
          path: 'src/a.ts',
          type: 'modified',
          timestamp: 2,
        },
      ],
      [{ key: 'src/a.ts', path: 'src/a.ts', status: 'modified', added: 1, removed: 0, hasUnstaged: true, hasStaged: true, diffLines: [] }]
    )

    expect(targets[0]).toMatchObject({
      canRevert: false,
      disabledReason: 'One or more files already have staged changes.',
    })
  })

  it('builds hard-stop guardrail state when usage exceeds limits', () => {
    const state = buildSessionGuardrailState({
      preferences: {
        enabled: true,
        tokenBudget: 100,
        runtimeBudgetMinutes: 10,
      },
      observedTokenTotal: 125,
      runtimeMinutes: 3,
      disabledForSession: false,
      continueOnceArmed: false,
    })

    expect(state.status).toBe('hard-stop')
    expect(state.tokenRatio).toBeGreaterThanOrEqual(1)
  })

  it('derives codex compaction state from observed turn totals', () => {
    const state = buildCodexCompactionState(
      [{ id: 'c1', kind: 'compaction', timestamp: 20 }],
      [
        { turnId: 't1', total: 90000, timestamp: 10 },
        { turnId: 't2', total: 12000, timestamp: 30 },
      ]
    )

    expect(state.compacted).toBe(true)
    expect(state.progress).toBeLessThan(0.2)
  })
})
