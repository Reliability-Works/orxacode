import type { Project } from '../types'

const SLUG_NON_ALPHANUM_RE = /[^a-z0-9]+/g
const SLUG_LEADING_TRAILING_DASH_RE = /^-+|-+$/g
const MAX_SLUG_LEN = 30

export function slugifyChatTitle(text: string): string {
  if (!text) return ''
  const lowered = text.toLowerCase()
  const dashed = lowered.replace(SLUG_NON_ALPHANUM_RE, '-')
  const trimmed = dashed.replace(SLUG_LEADING_TRAILING_DASH_RE, '')
  if (!trimmed) return ''
  return trimmed.slice(0, MAX_SLUG_LEN).replace(SLUG_LEADING_TRAILING_DASH_RE, '')
}

export function chatDateFolder(date: Date = new Date()): string {
  const y = date.getFullYear().toString().padStart(4, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isChatProjectCwd(cwd: string | null | undefined, baseDir: string | null): boolean {
  if (!cwd || !baseDir) return false
  const normalizedBase = baseDir.endsWith('/') ? baseDir : `${baseDir}/`
  return cwd.startsWith(normalizedBase)
}

export function isChatProject(
  project: Pick<Project, 'cwd'> | null | undefined,
  baseDir: string | null
): boolean {
  if (!project) return false
  return isChatProjectCwd(project.cwd, baseDir)
}
