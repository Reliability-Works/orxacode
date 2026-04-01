import {
  buildSyntheticCommandDiff,
  captureGitDiffSnapshot,
  captureGitStatusSnapshot,
  isSameGitDiffSnapshotEntry,
  isSameGitStatusSnapshotEntry,
  type CommandDiffBaseline,
} from './codex-diff-helpers'
import { parseGitDiffOutput, parseGitStatusOutput } from '../lib/git-diff'
import type { CodexMessageItem } from './codex-session-types'

type ReadProjectFileContent = (relativePath: string) => Promise<string | null>

type UpdateMessages = (
  updater: (previous: CodexMessageItem[]) => CodexMessageItem[],
  priority?: 'normal' | 'deferred'
) => void

type AttributeOptions = {
  status?: 'running' | 'completed'
  clearBaseline?: boolean
}

type OpencodeGitApi = {
  gitDiff: (directory: string) => Promise<string>
  gitStatus?: (directory: string) => Promise<string>
}

const COMMAND_DIFF_CONTENT_BASELINE_LIMIT = 24

function collectDirtyPaths(baseline: CommandDiffBaseline) {
  return [
    ...new Set([
      ...[...baseline.snapshot.values()].map(entry => entry.path),
      ...[...baseline.statusSnapshot.values()].map(entry => entry.path),
    ]),
  ]
}

async function readDirtyContents(
  dirtyPaths: string[],
  readProjectFileContent: ReadProjectFileContent
) {
  const dirtyContents = new Map<string, string | null>()
  await Promise.all(
    dirtyPaths.slice(0, COMMAND_DIFF_CONTENT_BASELINE_LIMIT).map(async path => {
      dirtyContents.set(path, await readProjectFileContent(path))
    })
  )
  return dirtyContents
}

async function readCurrentSnapshots(directory: string, opencode: OpencodeGitApi) {
  const [diffOutput, statusOutput] = await Promise.all([
    opencode.gitDiff(directory),
    opencode.gitStatus?.(directory) ?? Promise.resolve(''),
  ])
  return {
    diffSnapshot: captureGitDiffSnapshot(parseGitDiffOutput(diffOutput).files),
    statusSnapshot: captureGitStatusSnapshot(parseGitStatusOutput(statusOutput).files),
  }
}

function collectChangedEntries(
  baseline: CommandDiffBaseline,
  current: Awaited<ReturnType<typeof readCurrentSnapshots>>
) {
  return [...new Set([...current.diffSnapshot.keys(), ...current.statusSnapshot.keys()])]
    .map(key => ({
      key,
      diffEntry: current.diffSnapshot.get(key),
      statusEntry: current.statusSnapshot.get(key),
    }))
    .filter(({ key, diffEntry, statusEntry }) => {
      if (statusEntry && !isSameGitStatusSnapshotEntry(baseline.statusSnapshot.get(key), statusEntry)) {
        return true
      }
      if (diffEntry && !isSameGitDiffSnapshotEntry(baseline.snapshot.get(key), diffEntry)) {
        return true
      }
      return false
    })
}

async function attributeChangedEntry(
  changedEntry: ReturnType<typeof collectChangedEntries>[number],
  baseline: CommandDiffBaseline,
  readProjectFileContent: ReadProjectFileContent
) {
  const { key, diffEntry, statusEntry } = changedEntry
  const resolvedPath = statusEntry?.path ?? diffEntry?.path ?? key
  const beforeContent = baseline.dirtyContents.get(resolvedPath)
  if (beforeContent !== undefined) {
    const afterContent =
      statusEntry?.status === 'deleted' ? null : await readProjectFileContent(resolvedPath)
    const isolated = buildSyntheticCommandDiff(resolvedPath, beforeContent, afterContent)
    return {
      path: resolvedPath,
      type: isolated.type,
      diff: isolated.diff || undefined,
      insertions: isolated.insertions,
      deletions: isolated.deletions,
    }
  }
  if (diffEntry) {
    return {
      path: diffEntry.path,
      type: diffEntry.type,
      diff: diffEntry.diff || undefined,
      insertions: diffEntry.insertions,
      deletions: diffEntry.deletions,
    }
  }
  const afterContent =
    statusEntry?.status === 'deleted' ? null : await readProjectFileContent(resolvedPath)
  const isolated = buildSyntheticCommandDiff(resolvedPath, null, afterContent)
  return {
    path: resolvedPath,
    type: statusEntry?.status ?? isolated.type,
    diff: isolated.diff || undefined,
    insertions: isolated.insertions,
    deletions: isolated.deletions,
  }
}

function applyAttributedEntries(
  previous: CodexMessageItem[],
  directory: string,
  codexItemId: string,
  anchorMessageId: string | undefined,
  entries: Awaited<ReturnType<typeof attributeChangedEntry>>[],
  status: 'running' | 'completed'
) {
  const attributed = entries.map((entry, index) => ({
    id: `${codexItemId}:git-diff:${entry.path}:${index}`,
    kind: 'diff' as const,
    path: normalizeWorkspaceRelativePath(entry.path, directory),
    type: entry.type,
    status,
    diff: entry.diff,
    insertions: entry.insertions,
    deletions: entry.deletions,
    timestamp: Date.now(),
  }))
  const withoutPrevious = previous.filter(
    message => !message.id.startsWith(`${codexItemId}:git-diff:`)
  )
  if (!anchorMessageId) {
    return [...withoutPrevious, ...attributed]
  }
  const anchorIndex = withoutPrevious.findIndex(message => message.id === anchorMessageId)
  if (anchorIndex < 0) {
    return [...withoutPrevious, ...attributed]
  }
  const next = [...withoutPrevious]
  next.splice(anchorIndex + 1, 0, ...attributed)
  return next
}

function normalizeWorkspaceRelativePath(rawPath: string, workspaceDirectory: string) {
  const normalizedPath = rawPath.trim().replace(/\\/g, '/')
  const normalizedWorkspace = workspaceDirectory.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  if (!normalizedPath || !normalizedWorkspace) {
    return normalizedPath
  }
  if (normalizedPath === normalizedWorkspace) {
    return '.'
  }
  if (normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1)
  }
  return normalizedPath
}

export async function captureCommandDiffSnapshotForDirectory(
  directory: string,
  opencode: OpencodeGitApi | undefined,
  readProjectFileContent: ReadProjectFileContent
) {
  if (!opencode) {
    return null
  }
  try {
    const baseline = await readCurrentSnapshots(directory, opencode)
    return {
      snapshot: baseline.diffSnapshot,
      statusSnapshot: baseline.statusSnapshot,
      dirtyContents: await readDirtyContents(
        collectDirtyPaths({
          snapshot: baseline.diffSnapshot,
          statusSnapshot: baseline.statusSnapshot,
          dirtyContents: new Map(),
        }),
        readProjectFileContent
      ),
    }
  } catch {
    return null
  }
}

export async function attributeCommandFileChangesForDirectory(params: {
  anchorMessageId?: string
  baseline: CommandDiffBaseline
  codexItemId: string
  directory: string
  opencode: OpencodeGitApi | undefined
  options?: AttributeOptions
  readProjectFileContent: ReadProjectFileContent
  updateMessages: UpdateMessages
}) {
  const {
    anchorMessageId,
    baseline,
    codexItemId,
    directory,
    opencode,
    options,
    readProjectFileContent,
    updateMessages,
  } = params

  if (!opencode) {
    return
  }

  try {
    const current = await readCurrentSnapshots(directory, opencode)
    const changedEntries = collectChangedEntries(baseline, current)
    if (changedEntries.length === 0) {
      updateMessages(
        prev => prev.filter(message => !message.id.startsWith(`${codexItemId}:git-diff:`)),
        'deferred'
      )
      return
    }

    const attributedEntries = await Promise.all(
      changedEntries.map(changedEntry =>
        attributeChangedEntry(changedEntry, baseline, readProjectFileContent)
      )
    )

    updateMessages(
      prev =>
        applyAttributedEntries(
          prev,
          directory,
          codexItemId,
          anchorMessageId,
          attributedEntries,
          options?.status ?? 'completed'
        ),
      'deferred'
    )
  } catch {
    // Best-effort only.
  }
}
