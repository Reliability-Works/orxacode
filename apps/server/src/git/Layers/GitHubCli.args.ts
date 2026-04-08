import type { GitHubCliShape } from '../Services/GitHubCli.ts'

type ListInput = Parameters<GitHubCliShape['listOpenPullRequests']>[0]
type CreateInput = Parameters<GitHubCliShape['createPullRequest']>[0]
type GetInput = Parameters<GitHubCliShape['getPullRequest']>[0]

export function buildListOpenPullRequestsArgs(input: ListInput): string[] {
  return [
    'pr',
    'list',
    '--head',
    input.headSelector,
    '--state',
    'open',
    '--limit',
    String(input.limit ?? 1),
    '--json',
    'number,title,url,baseRefName,headRefName',
  ]
}

export function buildCreatePullRequestArgs(input: CreateInput): string[] {
  return [
    'pr',
    'create',
    '--base',
    input.baseBranch,
    '--head',
    input.headSelector,
    '--title',
    input.title,
    '--body-file',
    input.bodyFile,
  ]
}

export function buildGetPullRequestArgs(input: GetInput): string[] {
  return [
    'pr',
    'view',
    input.reference,
    '--json',
    'number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner',
  ]
}
