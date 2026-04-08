import type { GitStatusResult } from '@orxa-code/contracts'
import { assert, describe, it } from 'vitest'
import {
  buildMenuItems,
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
  resolveQuickAction,
} from './GitActionsControl.logic'

function status(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    branch: 'feature/test',
    hasWorkingTreeChanges: false,
    workingTree: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    ...overrides,
  }
}

describe('when: branch is clean and has an open PR', () => {
  it('resolveQuickAction opens the existing PR', () => {
    const quick = resolveQuickAction(
      status({
        pr: {
          number: 10,
          title: 'Open PR',
          url: 'https://example.com/pr/10',
          baseBranch: 'main',
          headBranch: 'feature/test',
          state: 'open',
        },
      }),
      false
    )
    assert.deepInclude(quick, { kind: 'open_pr', label: 'View PR', disabled: false })
  })

  it('buildMenuItems disables commit/push and enables open PR', () => {
    const items = buildMenuItems(
      status({
        pr: {
          number: 11,
          title: 'Existing PR',
          url: 'https://example.com/pr/11',
          baseBranch: 'main',
          headBranch: 'feature/test',
          state: 'open',
        },
      }),
      false
    )
    assert.deepEqual(items, [
      {
        id: 'commit',
        label: 'Commit',
        disabled: true,
        icon: 'commit',
        kind: 'open_dialog',
        dialogAction: 'commit',
      },
      {
        id: 'push',
        label: 'Push',
        disabled: true,
        icon: 'push',
        kind: 'open_dialog',
        dialogAction: 'push',
      },
      {
        id: 'pr',
        label: 'View PR',
        disabled: false,
        icon: 'pr',
        kind: 'open_pr',
      },
    ])
  })
})

describe('when: actions are busy', () => {
  it('resolveQuickAction returns running disabled state', () => {
    const quick = resolveQuickAction(status(), true)
    assert.deepInclude(quick, {
      kind: 'show_hint',
      label: 'Commit',
      disabled: true,
      hint: 'Git action in progress.',
    })
  })

  it('buildMenuItems disables all actions', () => {
    const items = buildMenuItems(status(), true)
    assert.deepEqual(items, [
      {
        id: 'commit',
        label: 'Commit',
        disabled: true,
        icon: 'commit',
        kind: 'open_dialog',
        dialogAction: 'commit',
      },
      {
        id: 'push',
        label: 'Push',
        disabled: true,
        icon: 'push',
        kind: 'open_dialog',
        dialogAction: 'push',
      },
      {
        id: 'pr',
        label: 'Create PR',
        disabled: true,
        icon: 'pr',
        kind: 'open_dialog',
        dialogAction: 'create_pr',
      },
    ])
  })
})

describe('when: git status is unavailable', () => {
  it('resolveQuickAction returns unavailable disabled state', () => {
    const quick = resolveQuickAction(null, false)
    assert.deepInclude(quick, {
      kind: 'show_hint',
      label: 'Commit',
      disabled: true,
      hint: 'Git status is unavailable.',
    })
  })

  it('buildMenuItems returns no menu items', () => {
    const items = buildMenuItems(null, false)
    assert.deepEqual(items, [])
  })
})

describe('when: branch is clean, ahead, and has an open PR', () => {
  it('resolveQuickAction prefers push', () => {
    const quick = resolveQuickAction(
      status({
        aheadCount: 3,
        pr: {
          number: 13,
          title: 'Open PR',
          url: 'https://example.com/pr/13',
          baseBranch: 'main',
          headBranch: 'feature/test',
          state: 'open',
        },
      }),
      false
    )
    assert.deepInclude(quick, { kind: 'run_action', action: 'commit_push', label: 'Push' })
  })

  it('buildMenuItems enables push and keeps open PR available', () => {
    const items = buildMenuItems(
      status({
        aheadCount: 2,
        pr: {
          number: 12,
          title: 'Existing PR',
          url: 'https://example.com/pr/12',
          baseBranch: 'main',
          headBranch: 'feature/test',
          state: 'open',
        },
      }),
      false
    )
    assert.deepEqual(items, [
      {
        id: 'commit',
        label: 'Commit',
        disabled: true,
        icon: 'commit',
        kind: 'open_dialog',
        dialogAction: 'commit',
      },
      {
        id: 'push',
        label: 'Push',
        disabled: false,
        icon: 'push',
        kind: 'open_dialog',
        dialogAction: 'push',
      },
      {
        id: 'pr',
        label: 'View PR',
        disabled: false,
        icon: 'pr',
        kind: 'open_pr',
      },
    ])
  })
})

describe('when: branch is clean, ahead, and has no open PR', () => {
  it('resolveQuickAction pushes and creates a PR', () => {
    const quick = resolveQuickAction(status({ aheadCount: 2, pr: null }), false)
    assert.deepInclude(quick, {
      kind: 'run_action',
      action: 'commit_push_pr',
      label: 'Push & create PR',
    })
  })

  it('buildMenuItems enables push and create PR, with commit disabled', () => {
    const items = buildMenuItems(status({ aheadCount: 2, pr: null }), false)
    assert.deepEqual(items, [
      {
        id: 'commit',
        label: 'Commit',
        disabled: true,
        icon: 'commit',
        kind: 'open_dialog',
        dialogAction: 'commit',
      },
      {
        id: 'push',
        label: 'Push',
        disabled: false,
        icon: 'push',
        kind: 'open_dialog',
        dialogAction: 'push',
      },
      {
        id: 'pr',
        label: 'Create PR',
        disabled: false,
        icon: 'pr',
        kind: 'open_dialog',
        dialogAction: 'create_pr',
      },
    ])
  })
})

describe('when: branch is clean, up to date, and has no open PR', () => {
  it('resolveQuickAction returns disabled no-action state', () => {
    const quick = resolveQuickAction(
      status({ aheadCount: 0, behindCount: 0, hasWorkingTreeChanges: false, pr: null }),
      false
    )
    assert.deepInclude(quick, { kind: 'show_hint', label: 'Commit', disabled: true })
  })

  it('buildMenuItems disables commit, push, and create PR', () => {
    const items = buildMenuItems(status({ aheadCount: 0, behindCount: 0, pr: null }), false)
    assert.deepEqual(items, [
      {
        id: 'commit',
        label: 'Commit',
        disabled: true,
        icon: 'commit',
        kind: 'open_dialog',
        dialogAction: 'commit',
      },
      {
        id: 'push',
        label: 'Push',
        disabled: true,
        icon: 'push',
        kind: 'open_dialog',
        dialogAction: 'push',
      },
      {
        id: 'pr',
        label: 'Create PR',
        disabled: true,
        icon: 'pr',
        kind: 'open_dialog',
        dialogAction: 'create_pr',
      },
    ])
  })
})

describe('when: branch is behind upstream', () => {
  it('resolveQuickAction returns pull', () => {
    const quick = resolveQuickAction(status({ behindCount: 2 }), false)
    assert.deepInclude(quick, { kind: 'run_pull', label: 'Pull', disabled: false })
  })

  it('buildMenuItems disables push and create PR', () => {
    const items = buildMenuItems(status({ behindCount: 1, pr: null }), false)
    assert.deepEqual(items, [
      {
        id: 'commit',
        label: 'Commit',
        disabled: true,
        icon: 'commit',
        kind: 'open_dialog',
        dialogAction: 'commit',
      },
      {
        id: 'push',
        label: 'Push',
        disabled: true,
        icon: 'push',
        kind: 'open_dialog',
        dialogAction: 'push',
      },
      {
        id: 'pr',
        label: 'Create PR',
        disabled: true,
        icon: 'pr',
        kind: 'open_dialog',
        dialogAction: 'create_pr',
      },
    ])
  })
})

describe('when: branch has diverged from upstream', () => {
  it('resolveQuickAction returns a disabled sync hint', () => {
    const quick = resolveQuickAction(status({ aheadCount: 2, behindCount: 1 }), false)
    assert.deepEqual(quick, {
      label: 'Sync branch',
      disabled: true,
      kind: 'show_hint',
      hint: 'Branch has diverged from upstream. Rebase/merge first.',
    })
  })
})

describe('requiresDefaultBranchConfirmation', () => {
  it('requires confirmation for push actions on default branch', () => {
    assert.isFalse(requiresDefaultBranchConfirmation('commit', true))
    assert.isTrue(requiresDefaultBranchConfirmation('commit_push', true))
    assert.isTrue(requiresDefaultBranchConfirmation('commit_push_pr', true))
    assert.isFalse(requiresDefaultBranchConfirmation('commit_push', false))
  })
})

describe('resolveDefaultBranchActionDialogCopy', () => {
  it('uses push-only copy when pushing without a commit', () => {
    const copy = resolveDefaultBranchActionDialogCopy({
      action: 'commit_push',
      branchName: 'main',
      includesCommit: false,
    })

    assert.deepEqual(copy, {
      title: 'Push to default branch?',
      description:
        'This action will push local commits on "main". You can continue on this branch or create a feature branch and run the same action there.',
      continueLabel: 'Push to main',
    })
  })

  it('uses push-and-pr copy when creating a PR without a commit', () => {
    const copy = resolveDefaultBranchActionDialogCopy({
      action: 'commit_push_pr',
      branchName: 'main',
      includesCommit: false,
    })

    assert.deepEqual(copy, {
      title: 'Push & create PR from default branch?',
      description:
        'This action will push local commits and create a PR on "main". You can continue on this branch or create a feature branch and run the same action there.',
      continueLabel: 'Push & create PR',
    })
  })

  it('keeps commit copy when the action includes a commit', () => {
    const copy = resolveDefaultBranchActionDialogCopy({
      action: 'commit_push_pr',
      branchName: 'main',
      includesCommit: true,
    })

    assert.deepEqual(copy, {
      title: 'Commit, push & create PR from default branch?',
      description:
        'This action will commit, push, and create a PR on "main". You can continue on this branch or create a feature branch and run the same action there.',
      continueLabel: 'Commit, push & create PR',
    })
  })
})
