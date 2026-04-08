import { realpathSync } from 'node:fs'

import {
  type GitActionProgressEvent,
  GitManagerError,
  type GitStatusResult,
} from '@orxa-code/contracts'
import { sanitizeBranchFragment } from '@orxa-code/shared/git'

const MAX_PROGRESS_TEXT_LENGTH = 500

type StripProgressContext<T> = T extends unknown ? Omit<T, 'actionId' | 'cwd' | 'action'> : never

export type GitActionProgressPayload = StripProgressContext<GitActionProgressEvent>

interface OpenPrInfo {
  number: number
  title: string
  url: string
  baseRefName: string
  headRefName: string
}

export interface PullRequestInfo extends OpenPrInfo {
  state: 'open' | 'closed' | 'merged'
  updatedAt: string | null
}

export interface ResolvedPullRequest {
  number: number
  title: string
  url: string
  baseBranch: string
  headBranch: string
  state: 'open' | 'closed' | 'merged'
}

export interface PullRequestHeadRemoteInfo {
  isCrossRepository?: boolean
  headRepositoryNameWithOwner?: string | null
  headRepositoryOwnerLogin?: string | null
}

export interface BranchHeadContext {
  localBranch: string
  headBranch: string
  headSelectors: ReadonlyArray<string>
  preferredHeadSelector: string
  remoteName: string | null
  headRepositoryNameWithOwner: string | null
  headRepositoryOwnerLogin: string | null
  isCrossRepository: boolean
}

export interface CommitAndBranchSuggestion {
  subject: string
  body: string
  branch?: string | undefined
  commitMessage: string
}

function parseRepositoryNameFromPullRequestUrl(url: string): string | null {
  const trimmed = url.trim()
  const match = /^https:\/\/github\.com\/[^/]+\/([^/]+)\/pull\/\d+(?:\/.*)?$/i.exec(trimmed)
  const repositoryName = match?.[1]?.trim() ?? ''
  return repositoryName.length > 0 ? repositoryName : null
}

function normalizePullRequestState(
  record: Record<string, unknown>
): PullRequestInfo['state'] | null {
  const state = record.state
  const mergedAt = record.mergedAt
  if ((typeof mergedAt === 'string' && mergedAt.trim().length > 0) || state === 'MERGED') {
    return 'merged'
  }
  if (state === 'OPEN' || state === undefined || state === null) {
    return 'open'
  }
  if (state === 'CLOSED') {
    return 'closed'
  }
  return null
}

function isValidPullRequestNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function parsePullRequestEntry(entry: unknown): PullRequestInfo | null {
  if (!entry || typeof entry !== 'object') {
    return null
  }

  const record = entry as Record<string, unknown>
  const { number, title, url, baseRefName, headRefName, updatedAt } = record

  if (
    !isValidPullRequestNumber(number) ||
    typeof title !== 'string' ||
    typeof url !== 'string' ||
    typeof baseRefName !== 'string' ||
    typeof headRefName !== 'string'
  ) {
    return null
  }

  const state = normalizePullRequestState(record)
  if (!state) {
    return null
  }

  return {
    number,
    title,
    url,
    baseRefName,
    headRefName,
    state,
    updatedAt: typeof updatedAt === 'string' && updatedAt.trim().length > 0 ? updatedAt : null,
  }
}

export function resolveHeadRepositoryNameWithOwner(
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo
): string | null {
  const explicitRepository = pullRequest.headRepositoryNameWithOwner?.trim() ?? ''
  if (explicitRepository.length > 0) {
    return explicitRepository
  }

  if (!pullRequest.isCrossRepository) {
    return null
  }

  const ownerLogin = pullRequest.headRepositoryOwnerLogin?.trim() ?? ''
  const repositoryName = parseRepositoryNameFromPullRequestUrl(pullRequest.url)
  if (ownerLogin.length === 0 || !repositoryName) {
    return null
  }

  return `${ownerLogin}/${repositoryName}`
}

export function resolvePullRequestWorktreeLocalBranchName(
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo
): string {
  if (!pullRequest.isCrossRepository) {
    return pullRequest.headBranch
  }

  const sanitizedHeadBranch = sanitizeBranchFragment(pullRequest.headBranch).trim()
  const suffix = sanitizedHeadBranch.length > 0 ? sanitizedHeadBranch : 'head'
  return `orxa/pr-${pullRequest.number}/${suffix}`
}

export function parseGitHubRepositoryNameWithOwnerFromRemoteUrl(url: string | null): string | null {
  const trimmed = url?.trim() ?? ''
  if (trimmed.length === 0) {
    return null
  }

  const match =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/|git:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(
      trimmed
    )
  const repositoryNameWithOwner = match?.[1]?.trim() ?? ''
  return repositoryNameWithOwner.length > 0 ? repositoryNameWithOwner : null
}

export function parseRepositoryOwnerLogin(nameWithOwner: string | null): string | null {
  const trimmed = nameWithOwner?.trim() ?? ''
  if (trimmed.length === 0) {
    return null
  }

  const [ownerLogin] = trimmed.split('/')
  const normalizedOwnerLogin = ownerLogin?.trim() ?? ''
  return normalizedOwnerLogin.length > 0 ? normalizedOwnerLogin : null
}

export function parsePullRequestList(raw: unknown): PullRequestInfo[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const parsed: PullRequestInfo[] = []
  for (const entry of raw) {
    const pullRequest = parsePullRequestEntry(entry)
    if (pullRequest) {
      parsed.push(pullRequest)
    }
  }
  return parsed
}

export function gitManagerError(
  operation: string,
  detail: string,
  cause?: unknown
): GitManagerError {
  return new GitManagerError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  })
}

export function limitContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value
  }
  return `${value.slice(0, maxChars)}\n\n[truncated]`
}

export function sanitizeCommitMessage(generated: {
  subject: string
  body: string
  branch?: string | undefined
}): {
  subject: string
  body: string
  branch?: string | undefined
} {
  const rawSubject = generated.subject.trim().split(/\r?\n/g)[0]?.trim() ?? ''
  const subject = rawSubject.replace(/[.]+$/g, '').trim()
  const safeSubject = subject.length > 0 ? subject.slice(0, 72).trimEnd() : 'Update project files'
  return {
    subject: safeSubject,
    body: generated.body.trim(),
    ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
  }
}

export function sanitizeProgressText(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  if (trimmed.length <= MAX_PROGRESS_TEXT_LENGTH) {
    return trimmed
  }
  return trimmed.slice(0, MAX_PROGRESS_TEXT_LENGTH).trimEnd()
}

export function formatCommitMessage(subject: string, body: string): string {
  const trimmedBody = body.trim()
  if (trimmedBody.length === 0) {
    return subject
  }
  return `${subject}\n\n${trimmedBody}`
}

export function parseCustomCommitMessage(raw: string): { subject: string; body: string } | null {
  const normalized = raw.replace(/\r\n/g, '\n').trim()
  if (normalized.length === 0) {
    return null
  }

  const [firstLine, ...rest] = normalized.split('\n')
  const subject = firstLine?.trim() ?? ''
  if (subject.length === 0) {
    return null
  }

  return {
    subject,
    body: rest.join('\n').trim(),
  }
}

export function extractBranchFromRef(ref: string): string {
  const normalized = ref.trim()
  if (normalized.startsWith('refs/remotes/')) {
    const withoutPrefix = normalized.slice('refs/remotes/'.length)
    const firstSlash = withoutPrefix.indexOf('/')
    if (firstSlash === -1) {
      return withoutPrefix.trim()
    }
    return withoutPrefix.slice(firstSlash + 1).trim()
  }

  const firstSlash = normalized.indexOf('/')
  if (firstSlash === -1) {
    return normalized
  }
  return normalized.slice(firstSlash + 1).trim()
}

export function appendUnique(values: string[], next: string | null | undefined): void {
  const trimmed = next?.trim() ?? ''
  if (trimmed.length === 0 || values.includes(trimmed)) {
    return
  }
  values.push(trimmed)
}

export function toStatusPr(pr: PullRequestInfo): Exclude<GitStatusResult['pr'], null> {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    state: pr.state,
  }
}

export function normalizePullRequestReference(reference: string): string {
  const trimmed = reference.trim()
  const hashNumber = /^#(\d+)$/.exec(trimmed)
  return hashNumber?.[1] ?? trimmed
}

export function canonicalizeExistingPath(value: string): string {
  try {
    return realpathSync.native(value)
  } catch {
    return value
  }
}

export function toResolvedPullRequest(pr: {
  number: number
  title: string
  url: string
  baseRefName: string
  headRefName: string
  state?: 'open' | 'closed' | 'merged'
}): ResolvedPullRequest {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    state: pr.state ?? 'open',
  }
}

export function shouldPreferSshRemote(url: string | null): boolean {
  if (!url) {
    return false
  }
  const trimmed = url.trim()
  return trimmed.startsWith('git@') || trimmed.startsWith('ssh://')
}

export function toPullRequestHeadRemoteInfo(pr: {
  isCrossRepository?: boolean
  headRepositoryNameWithOwner?: string | null
  headRepositoryOwnerLogin?: string | null
}): PullRequestHeadRemoteInfo {
  return {
    ...(pr.isCrossRepository !== undefined ? { isCrossRepository: pr.isCrossRepository } : {}),
    ...(pr.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: pr.headRepositoryNameWithOwner }
      : {}),
    ...(pr.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: pr.headRepositoryOwnerLogin }
      : {}),
  }
}
