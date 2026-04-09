import type {
  GitRunStackedActionResult,
  GitStackedAction,
  GitStatusResult,
} from '@orxa-code/contracts'

export type GitActionIconName = 'commit' | 'push' | 'pr'

export type GitDialogAction = 'commit' | 'push' | 'create_pr'

export interface GitActionMenuItem {
  id: 'commit' | 'push' | 'pr'
  label: string
  disabled: boolean
  icon: GitActionIconName
  kind: 'open_dialog' | 'open_pr'
  dialogAction?: GitDialogAction
}

export interface GitQuickAction {
  label: string
  disabled: boolean
  kind: 'run_action' | 'run_pull' | 'open_pr' | 'show_hint'
  action?: GitStackedAction
  hint?: string
}

export interface DefaultBranchActionDialogCopy {
  title: string
  description: string
  continueLabel: string
}

export type DefaultBranchConfirmableAction = 'commit_push' | 'commit_push_pr'

const SHORT_SHA_LENGTH = 7
const TOAST_DESCRIPTION_MAX = 72

interface GitActionState {
  hasBranch: boolean
  hasChanges: boolean
  hasOpenPr: boolean
  isAhead: boolean
  isBehind: boolean
  isDiverged: boolean
  hasUpstream: boolean
  canPushWithoutUpstream: boolean
  isDefaultBranch: boolean
}

function shortenSha(sha: string | undefined): string | null {
  if (!sha) return null
  return sha.slice(0, SHORT_SHA_LENGTH)
}

function truncateText(
  value: string | undefined,
  maxLength = TOAST_DESCRIPTION_MAX
): string | undefined {
  if (!value) return undefined
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return '...'.slice(0, maxLength)
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export function buildGitActionProgressStages(input: {
  action: GitStackedAction
  hasCustomCommitMessage: boolean
  hasWorkingTreeChanges: boolean
  forcePushOnly?: boolean
  pushTarget?: string
  featureBranch?: boolean
}): string[] {
  const branchStages = input.featureBranch ? ['Preparing feature branch...'] : []
  const shouldIncludeCommitStages =
    !input.forcePushOnly && (input.action === 'commit' || input.hasWorkingTreeChanges)
  const commitStages = !shouldIncludeCommitStages
    ? []
    : input.hasCustomCommitMessage
      ? ['Committing...']
      : ['Generating commit message...', 'Committing...']
  const pushStage = input.pushTarget ? `Pushing to ${input.pushTarget}...` : 'Pushing...'
  if (input.action === 'commit') {
    return [...branchStages, ...commitStages]
  }
  if (input.action === 'commit_push') {
    return [...branchStages, ...commitStages, pushStage]
  }
  return [...branchStages, ...commitStages, pushStage, 'Creating PR...']
}

const withDescription = (title: string, description: string | undefined) =>
  description ? { title, description } : { title }

function deriveGitActionState(
  gitStatus: GitStatusResult,
  hasOriginRemote: boolean,
  isDefaultBranch = false
): GitActionState {
  const hasBranch = gitStatus.branch !== null
  const hasChanges = gitStatus.hasWorkingTreeChanges
  const hasOpenPr = gitStatus.pr?.state === 'open'
  const isAhead = gitStatus.aheadCount > 0
  const isBehind = gitStatus.behindCount > 0

  return {
    hasBranch,
    hasChanges,
    hasOpenPr,
    isAhead,
    isBehind,
    isDiverged: isAhead && isBehind,
    hasUpstream: gitStatus.hasUpstream,
    canPushWithoutUpstream: hasOriginRemote && !gitStatus.hasUpstream,
    isDefaultBranch,
  }
}

function resolveDirtyTreeQuickAction(): GitQuickAction {
  return { label: 'Commit', disabled: false, kind: 'run_action', action: 'commit' }
}

function resolveAheadQuickAction(state: GitActionState): GitQuickAction {
  if (state.hasOpenPr || state.isDefaultBranch) {
    return { label: 'Push', disabled: false, kind: 'run_action', action: 'commit_push' }
  }
  return {
    label: 'Push & create PR',
    disabled: false,
    kind: 'run_action',
    action: 'commit_push_pr',
  }
}

function resolveNoUpstreamQuickAction(state: GitActionState): GitQuickAction {
  if (!state.canPushWithoutUpstream) {
    if (state.hasOpenPr && !state.isAhead) {
      return { label: 'View PR', disabled: false, kind: 'open_pr' }
    }
    return {
      label: 'Push',
      disabled: true,
      kind: 'show_hint',
      hint: 'Add an "origin" remote before pushing or creating a PR.',
    }
  }
  if (!state.isAhead) {
    if (state.hasOpenPr) {
      return { label: 'View PR', disabled: false, kind: 'open_pr' }
    }
    return {
      label: 'Push',
      disabled: true,
      kind: 'show_hint',
      hint: 'No local commits to push.',
    }
  }
  return resolveAheadQuickAction(state)
}

function buildPrMenuItem(input: {
  hasOpenPr: boolean
  canCreatePr: boolean
  canOpenPr: boolean
}): GitActionMenuItem {
  if (input.hasOpenPr) {
    return {
      id: 'pr',
      label: 'View PR',
      disabled: !input.canOpenPr,
      icon: 'pr',
      kind: 'open_pr',
    }
  }
  return {
    id: 'pr',
    label: 'Create PR',
    disabled: !input.canCreatePr,
    icon: 'pr',
    kind: 'open_dialog',
    dialogAction: 'create_pr',
  }
}

export function summarizeGitResult(result: GitRunStackedActionResult): {
  title: string
  description?: string
} {
  if (result.pr.status === 'created' || result.pr.status === 'opened_existing') {
    const prNumber = result.pr.number ? ` #${result.pr.number}` : ''
    const title = `${result.pr.status === 'created' ? 'Created PR' : 'Opened PR'}${prNumber}`
    return withDescription(title, truncateText(result.pr.title))
  }

  if (result.push.status === 'pushed') {
    const shortSha = shortenSha(result.commit.commitSha)
    const branch = result.push.upstreamBranch ?? result.push.branch
    const pushedCommitPart = shortSha ? ` ${shortSha}` : ''
    const branchPart = branch ? ` to ${branch}` : ''
    return withDescription(
      `Pushed${pushedCommitPart}${branchPart}`,
      truncateText(result.commit.subject)
    )
  }

  if (result.commit.status === 'created') {
    const shortSha = shortenSha(result.commit.commitSha)
    const title = shortSha ? `Committed ${shortSha}` : 'Committed changes'
    return withDescription(title, truncateText(result.commit.subject))
  }

  return { title: 'Done' }
}

export function buildMenuItems(
  gitStatus: GitStatusResult | null,
  isBusy: boolean,
  hasOriginRemote = true
): GitActionMenuItem[] {
  if (!gitStatus) return []

  const state = deriveGitActionState(gitStatus, hasOriginRemote)
  const canCommit = !isBusy && state.hasChanges
  const canPush =
    !isBusy &&
    state.hasBranch &&
    !state.hasChanges &&
    !state.isBehind &&
    state.isAhead &&
    (state.hasUpstream || state.canPushWithoutUpstream)
  const canCreatePr =
    !isBusy &&
    state.hasBranch &&
    !state.hasChanges &&
    !state.hasOpenPr &&
    state.isAhead &&
    !state.isBehind &&
    (state.hasUpstream || state.canPushWithoutUpstream)
  const canOpenPr = !isBusy && state.hasOpenPr

  return [
    {
      id: 'commit',
      label: 'Commit',
      disabled: !canCommit,
      icon: 'commit',
      kind: 'open_dialog',
      dialogAction: 'commit',
    },
    {
      id: 'push',
      label: 'Push',
      disabled: !canPush,
      icon: 'push',
      kind: 'open_dialog',
      dialogAction: 'push',
    },
    buildPrMenuItem({
      hasOpenPr: state.hasOpenPr,
      canCreatePr,
      canOpenPr,
    }),
  ]
}

export function resolveQuickAction(
  gitStatus: GitStatusResult | null,
  isBusy: boolean,
  isDefaultBranch = false,
  hasOriginRemote = true
): GitQuickAction {
  if (isBusy) {
    return { label: 'Commit', disabled: true, kind: 'show_hint', hint: 'Git action in progress.' }
  }

  if (!gitStatus) {
    return {
      label: 'Commit',
      disabled: true,
      kind: 'show_hint',
      hint: 'Git status is unavailable.',
    }
  }

  const state = deriveGitActionState(gitStatus, hasOriginRemote, isDefaultBranch)

  if (!state.hasBranch) {
    return {
      label: 'Commit',
      disabled: true,
      kind: 'show_hint',
      hint: 'Create and checkout a branch before pushing or opening a PR.',
    }
  }

  if (state.hasChanges) {
    return resolveDirtyTreeQuickAction()
  }

  if (!state.hasUpstream) {
    return resolveNoUpstreamQuickAction(state)
  }

  if (state.isDiverged) {
    return {
      label: 'Sync branch',
      disabled: true,
      kind: 'show_hint',
      hint: 'Branch has diverged from upstream. Rebase/merge first.',
    }
  }

  if (state.isBehind) {
    return {
      label: 'Pull',
      disabled: false,
      kind: 'run_pull',
    }
  }

  if (state.isAhead) {
    return resolveAheadQuickAction(state)
  }

  if (state.hasOpenPr && state.hasUpstream) {
    return { label: 'View PR', disabled: false, kind: 'open_pr' }
  }

  return {
    label: 'Commit',
    disabled: true,
    kind: 'show_hint',
    hint: 'Branch is up to date. No action needed.',
  }
}

export function requiresDefaultBranchConfirmation(
  action: GitStackedAction,
  isDefaultBranch: boolean
): boolean {
  if (!isDefaultBranch) return false
  return action === 'commit_push' || action === 'commit_push_pr'
}

export function resolveDefaultBranchActionDialogCopy(input: {
  action: DefaultBranchConfirmableAction
  branchName: string
  includesCommit: boolean
}): DefaultBranchActionDialogCopy {
  const branchLabel = input.branchName
  const suffix = ` on "${branchLabel}". You can continue on this branch or create a feature branch and run the same action there.`

  if (input.action === 'commit_push') {
    if (input.includesCommit) {
      return {
        title: 'Commit & push to default branch?',
        description: `This action will commit and push changes${suffix}`,
        continueLabel: `Commit & push to ${branchLabel}`,
      }
    }
    return {
      title: 'Push to default branch?',
      description: `This action will push local commits${suffix}`,
      continueLabel: `Push to ${branchLabel}`,
    }
  }

  if (input.includesCommit) {
    return {
      title: 'Commit, push & create PR from default branch?',
      description: `This action will commit, push, and create a PR${suffix}`,
      continueLabel: `Commit, push & create PR`,
    }
  }
  return {
    title: 'Push & create PR from default branch?',
    description: `This action will push local commits and create a PR${suffix}`,
    continueLabel: 'Push & create PR',
  }
}

// Re-export from shared for backwards compatibility in this module's exports
export { resolveAutoFeatureBranchName } from '@orxa-code/shared/git'
