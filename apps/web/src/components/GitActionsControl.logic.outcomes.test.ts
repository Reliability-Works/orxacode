import { assert, describe, it } from 'vitest'
import {
  buildGitActionProgressStages,
  resolveAutoFeatureBranchName,
  summarizeGitResult,
} from './GitActionsControl.logic'

describe('buildGitActionProgressStages', () => {
  it('shows only push progress when push-only is forced', () => {
    const stages = buildGitActionProgressStages({
      action: 'commit_push',
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: true,
      forcePushOnly: true,
      pushTarget: 'origin/feature/test',
    })
    assert.deepEqual(stages, ['Pushing to origin/feature/test...'])
  })

  it('skips commit stages for create-pr flow when push-only is forced', () => {
    const stages = buildGitActionProgressStages({
      action: 'commit_push_pr',
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: true,
      forcePushOnly: true,
      pushTarget: 'origin/feature/test',
    })
    assert.deepEqual(stages, ['Pushing to origin/feature/test...', 'Creating PR...'])
  })

  it('includes commit stages for commit+push when working tree is dirty', () => {
    const stages = buildGitActionProgressStages({
      action: 'commit_push',
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: true,
      pushTarget: 'origin/feature/test',
    })
    assert.deepEqual(stages, [
      'Generating commit message...',
      'Committing...',
      'Pushing to origin/feature/test...',
    ])
  })
})

describe('summarizeGitResult', () => {
  it('returns commit-focused toast for commit action', () => {
    const result = summarizeGitResult({
      action: 'commit',
      branch: { status: 'skipped_not_requested' },
      commit: {
        status: 'created',
        commitSha: '0123456789abcdef',
        subject: 'feat: add optimistic UI for git action button',
      },
      push: { status: 'skipped_not_requested' },
      pr: { status: 'skipped_not_requested' },
    })

    assert.deepEqual(result, {
      title: 'Committed 0123456',
      description: 'feat: add optimistic UI for git action button',
    })
  })

  it('returns push-focused toast for push action', () => {
    const result = summarizeGitResult({
      action: 'commit_push',
      branch: { status: 'skipped_not_requested' },
      commit: {
        status: 'created',
        commitSha: 'abcdef0123456789',
        subject: 'fix: tighten quick action tooltip hover handling',
      },
      push: {
        status: 'pushed',
        branch: 'foo',
        upstreamBranch: 'origin/foo',
      },
      pr: { status: 'skipped_not_requested' },
    })

    assert.deepEqual(result, {
      title: 'Pushed abcdef0 to origin/foo',
      description: 'fix: tighten quick action tooltip hover handling',
    })
  })
})

describe('summarizeGitResult PR outcomes', () => {
  it('returns PR-focused toast for created PR action', () => {
    const result = summarizeGitResult({
      action: 'commit_push_pr',
      branch: { status: 'skipped_not_requested' },
      commit: {
        status: 'created',
        commitSha: '89abcdef01234567',
        subject: 'feat: ship github shortcuts',
      },
      push: {
        status: 'pushed',
        branch: 'foo',
      },
      pr: {
        status: 'created',
        number: 42,
        title: 'feat: ship github shortcuts and improve PR CTA in success toast',
      },
    })

    assert.deepEqual(result, {
      title: 'Created PR #42',
      description: 'feat: ship github shortcuts and improve PR CTA in success toast',
    })
  })

  it('truncates long description text', () => {
    const result = summarizeGitResult({
      action: 'commit_push_pr',
      branch: { status: 'skipped_not_requested' },
      commit: {
        status: 'created',
        commitSha: '89abcdef01234567',
        subject: 'short subject',
      },
      push: { status: 'pushed', branch: 'foo' },
      pr: {
        status: 'created',
        number: 99,
        title:
          'feat: this title is intentionally extremely long so we can validate that toast descriptions are truncated with an ellipsis suffix',
      },
    })

    assert.deepEqual(result, {
      title: 'Created PR #99',
      description: 'feat: this title is intentionally extremely long so we can validate t...',
    })
  })
})

describe('resolveAutoFeatureBranchName', () => {
  it('uses semantic preferred branch names when available', () => {
    const branch = resolveAutoFeatureBranchName(['main', 'feature/other'], 'fix toast copy')
    assert.equal(branch, 'feature/fix-toast-copy')
  })

  it('normalizes preferred names that already include a branch namespace', () => {
    const branch = resolveAutoFeatureBranchName(['main'], 'feature/refine-toolbar-actions')
    assert.equal(branch, 'feature/refine-toolbar-actions')
  })

  it('increments suffix when the preferred branch name already exists', () => {
    const branch = resolveAutoFeatureBranchName(
      ['main', 'feature/fix-toast-copy', 'feature/fix-toast-copy-2'],
      'fix toast copy'
    )
    assert.equal(branch, 'feature/fix-toast-copy-3')
  })

  it('treats existing branch names as case-insensitive for collision checks', () => {
    const branch = resolveAutoFeatureBranchName(['Feature/Ticket-1'], 'feature/ticket-1')
    assert.equal(branch, 'feature/ticket-1-2')
  })

  it('falls back to feature/update when no preferred name is provided', () => {
    const branch = resolveAutoFeatureBranchName(['main'])
    assert.equal(branch, 'feature/update')
  })
})
