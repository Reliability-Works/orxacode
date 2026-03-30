import { compactText } from './text-utils'

export function compactPathPreservingBasename(value: string, maxLength = 58) {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= maxLength) {
    return singleLine
  }
  const normalized = singleLine.replace(/\\/g, '/')
  const slashIndex = normalized.lastIndexOf('/')
  if (slashIndex < 0) {
    return compactText(singleLine, maxLength)
  }
  const basename = normalized.slice(slashIndex + 1)
  if (!basename) {
    return compactText(singleLine, maxLength)
  }
  const reserved = basename.length + 4
  if (reserved >= maxLength) {
    return `...${basename.slice(-(maxLength - 3))}`
  }
  const prefixBudget = maxLength - reserved
  const prefix = normalized.slice(0, prefixBudget).replace(/[/. -]+$/g, '')
  return `${prefix}.../${basename}`
}

export function toWorkspaceRelativePath(target: string, workspaceDirectory?: string | null) {
  const normalizedTarget = target.replace(/\\/g, '/').replace(/\/+$/g, '')
  const normalizedWorkspace = (workspaceDirectory ?? '').replace(/\\/g, '/').replace(/\/+$/g, '')
  if (!normalizedWorkspace) {
    return normalizedTarget
  }
  if (normalizedTarget === normalizedWorkspace) {
    return '.'
  }
  if (normalizedTarget.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedTarget.slice(normalizedWorkspace.length + 1)
  }
  const embeddedWorkspaceIndex = normalizedTarget.indexOf(`${normalizedWorkspace}/`)
  if (embeddedWorkspaceIndex >= 0) {
    return normalizedTarget.slice(embeddedWorkspaceIndex + normalizedWorkspace.length + 1)
  }
  return normalizedTarget
}

export function formatTarget(target: string, workspaceDirectory?: string | null, maxLength = 58) {
  return compactPathPreservingBasename(
    toWorkspaceRelativePath(target, workspaceDirectory),
    maxLength
  )
}
