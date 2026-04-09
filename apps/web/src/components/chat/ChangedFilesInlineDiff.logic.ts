import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs/react'

import { buildPatchCacheKey } from '../../lib/diffRendering'

function normalizeDiffPath(path: string): string {
  return path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path
}

export function findChangedFileDiff(
  patch: string | undefined,
  filePath: string,
  cacheScope = 'changed-files-inline'
): FileDiffMetadata | null {
  if (!patch) return null
  const normalizedPatch = patch.trim()
  if (normalizedPatch.length === 0) return null
  const parsedPatches = parsePatchFiles(
    normalizedPatch,
    buildPatchCacheKey(normalizedPatch, cacheScope)
  )
  const files = parsedPatches.flatMap(entry => entry.files)
  return (
    files.find(fileDiff => {
      const candidate = normalizeDiffPath(fileDiff.name ?? fileDiff.prevName ?? '')
      return candidate === filePath
    }) ?? null
  )
}
