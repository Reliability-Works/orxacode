import {
  buildSyntheticCommandDiff,
  captureGitDiffSnapshot,
  captureGitStatusSnapshot,
  looksLikeUnifiedDiff,
  type FileChangeDescriptor,
  type GitSnapshotLookup,
} from './codex-diff-helpers'
import { parseGitDiffOutput, parseGitStatusOutput } from '../lib/git-diff'
import { normalizeWorkspaceRelativePath } from './codex-session-notification-dispatch'

// ---------------------------------------------------------------------------
// Opencode bridge subset needed for enrichment
// ---------------------------------------------------------------------------

interface OpencodeBridge {
  gitDiff: (directory: string) => Promise<string>
  gitStatus?: (directory: string) => Promise<string>
}

// ---------------------------------------------------------------------------
// enrichFileChangeDescriptors
// ---------------------------------------------------------------------------

export async function enrichFileChangeDescriptors(
  descriptors: FileChangeDescriptor[],
  directory: string,
  readProjectFileContent: (path: string) => Promise<string | null>,
  opencode: OpencodeBridge | undefined
): Promise<FileChangeDescriptor[]> {
  if (!opencode || descriptors.length === 0) {
    return descriptors
  }

  const needsEnrichment = descriptors.some(
    descriptor =>
      !looksLikeUnifiedDiff(descriptor.diff) ||
      descriptor.insertions === undefined ||
      descriptor.deletions === undefined
  )
  if (!needsEnrichment) {
    return descriptors
  }

  try {
    const [diffOutput, statusOutput] = await Promise.all([
      opencode.gitDiff(directory),
      opencode.gitStatus?.(directory) ?? Promise.resolve(''),
    ])
    const diffSnapshot = captureGitDiffSnapshot(parseGitDiffOutput(diffOutput).files)
    const statusSnapshot = captureGitStatusSnapshot(parseGitStatusOutput(statusOutput).files)
    const lookup: GitSnapshotLookup = {
      diffByPath: new Map(),
      statusByPath: new Map(),
    }

    for (const entry of diffSnapshot.values()) {
      const normalizedPath = normalizeWorkspaceRelativePath(entry.path, directory)
      lookup.diffByPath.set(normalizedPath, entry)
      if (entry.oldPath) {
        lookup.diffByPath.set(normalizeWorkspaceRelativePath(entry.oldPath, directory), entry)
      }
    }

    for (const entry of statusSnapshot.values()) {
      const normalizedPath = normalizeWorkspaceRelativePath(entry.path, directory)
      lookup.statusByPath.set(normalizedPath, entry)
      if (entry.oldPath) {
        lookup.statusByPath.set(normalizeWorkspaceRelativePath(entry.oldPath, directory), entry)
      }
    }

    return Promise.all(
      descriptors.map(async descriptor => {
        if (
          looksLikeUnifiedDiff(descriptor.diff) &&
          descriptor.insertions !== undefined &&
          descriptor.deletions !== undefined
        ) {
          return descriptor
        }

        const normalizedPath = normalizeWorkspaceRelativePath(descriptor.path, directory)
        const diffEntry = lookup.diffByPath.get(normalizedPath)
        if (diffEntry) {
          return {
            ...descriptor,
            type: descriptor.type || diffEntry.type,
            diff: looksLikeUnifiedDiff(descriptor.diff)
              ? descriptor.diff
              : diffEntry.diff || undefined,
            insertions: descriptor.insertions ?? diffEntry.insertions,
            deletions: descriptor.deletions ?? diffEntry.deletions,
          }
        }

        const statusEntry = lookup.statusByPath.get(normalizedPath)
        if (!statusEntry) {
          return descriptor
        }

        if (statusEntry.status === 'added') {
          const afterContent = await readProjectFileContent(normalizedPath)
          const synthetic = buildSyntheticCommandDiff(normalizedPath, null, afterContent)
          return {
            ...descriptor,
            type: descriptor.type || synthetic.type,
            diff: looksLikeUnifiedDiff(descriptor.diff)
              ? descriptor.diff
              : synthetic.diff || undefined,
            insertions: descriptor.insertions ?? synthetic.insertions,
            deletions: descriptor.deletions ?? synthetic.deletions,
          }
        }

        return {
          ...descriptor,
          type: descriptor.type || statusEntry.status,
        }
      })
    )
  } catch {
    return descriptors
  }
}
