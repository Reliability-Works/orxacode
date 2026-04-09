import type { GitDiffResult, GitDiffScopeKind } from '@orxa-code/contracts'

export function getHeaderDiffStats(
  diffData: GitDiffResult | undefined,
  scope: GitDiffScopeKind
) {
  if (!diffData) return null
  const summary = diffData.scopeSummaries.find(item => item.scope === scope) ?? null
  if (!summary) return null
  return { additions: summary.additions, deletions: summary.deletions }
}
