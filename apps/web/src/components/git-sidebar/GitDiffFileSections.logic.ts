import type {
  GitDiffFile,
  GitDiffResult,
  GitDiffScopeKind,
  GitDiffSectionKind,
} from '@orxa-code/contracts'

export const SECTION_LABELS: Record<GitDiffSectionKind, string> = {
  branch: 'Branch',
  staged: 'Staged',
  unstaged: 'Unstaged',
  untracked: 'Untracked',
}

type DiffSectionView = {
  kind: GitDiffSectionKind
  label: string
  files: ReadonlyArray<GitDiffFile>
}

export function getVisibleDiffSections(
  data: GitDiffResult,
  scope: GitDiffScopeKind
): DiffSectionView[] {
  if (scope === 'staged') {
    return [{ kind: 'staged', label: SECTION_LABELS.staged, files: data.staged }]
  }
  if (scope === 'branch') {
    return [{ kind: 'branch', label: SECTION_LABELS.branch, files: data.branch?.files ?? [] }]
  }
  return [
    { kind: 'unstaged', label: SECTION_LABELS.unstaged, files: data.unstaged },
    { kind: 'untracked', label: SECTION_LABELS.untracked, files: data.untracked },
  ]
}

export function getVisibleDiffFiles(data: GitDiffResult, scope: GitDiffScopeKind): GitDiffFile[] {
  return getVisibleDiffSections(data, scope).flatMap(section => section.files)
}
