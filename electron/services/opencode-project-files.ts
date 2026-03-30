import path from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import type { ProjectFileDocument, ProjectFileEntry } from '../../shared/ipc'

export const PROJECT_FILE_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  '.turbo',
])

export function resolveWithinRoot(root: string, relativePath: string) {
  const normalized = relativePath.trim()
  if (!normalized) {
    return root
  }
  const candidate = path.resolve(root, normalized)
  const rel = path.relative(root, candidate)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid file path')
  }
  return candidate
}

export async function listProjectFiles(
  directory: string,
  relativePath = ''
): Promise<ProjectFileEntry[]> {
  const root = path.resolve(directory)
  const resolved = resolveWithinRoot(root, relativePath)
  const info = await stat(resolved).catch(() => undefined)
  if (!info?.isDirectory()) {
    throw new Error('Directory not found')
  }

  const entries = await readdir(resolved, { withFileTypes: true }).catch(() => [])
  return entries
    .filter(entry => !entry.name.startsWith('.DS_Store'))
    .filter(entry => !(entry.isDirectory() && PROJECT_FILE_SKIP_DIRS.has(entry.name)))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) {
        return -1
      }
      if (!a.isDirectory() && b.isDirectory()) {
        return 1
      }
      return a.name.localeCompare(b.name)
    })
    .map(entry => {
      const absolutePath = path.join(resolved, entry.name)
      const rel = path.relative(root, absolutePath)
      return {
        name: entry.name,
        path: absolutePath,
        relativePath: rel,
        type: entry.isDirectory() ? 'directory' : 'file',
        hasChildren: entry.isDirectory() ? true : undefined,
      }
    })
}

export async function countProjectFiles(directory: string): Promise<number> {
  const root = path.resolve(directory)
  const info = await stat(root).catch(() => undefined)
  if (!info?.isDirectory()) {
    throw new Error('Directory not found')
  }

  const countDirectory = async (directoryPath: string): Promise<number> => {
    const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => [])
    let total = 0
    for (const entry of entries) {
      if (entry.name.startsWith('.DS_Store')) {
        continue
      }
      const absolutePath = path.join(directoryPath, entry.name)
      if (entry.isDirectory()) {
        if (PROJECT_FILE_SKIP_DIRS.has(entry.name)) {
          continue
        }
        total += await countDirectory(absolutePath)
        continue
      }
      total += 1
    }
    return total
  }

  return countDirectory(root)
}

export async function readProjectFile(
  directory: string,
  relativePath: string
): Promise<ProjectFileDocument> {
  const root = path.resolve(directory)
  const filePath = resolveWithinRoot(root, relativePath)
  const info = await stat(filePath).catch(() => undefined)
  if (!info?.isFile()) {
    throw new Error('File not found')
  }

  const maxBytes = 220_000
  const raw = await readFile(filePath)
  const binary = raw.includes(0)
  const truncated = raw.byteLength > maxBytes
  const content = binary
    ? '[Binary file preview unavailable]'
    : raw.subarray(0, maxBytes).toString('utf8')

  return {
    path: filePath,
    relativePath: path.relative(root, filePath),
    content,
    binary,
    truncated,
  }
}
