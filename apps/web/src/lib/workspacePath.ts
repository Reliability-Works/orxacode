export function toWorkspaceRelativePath(
  absolutePath: string,
  workspaceRoot: string | undefined
): string {
  if (!workspaceRoot) return absolutePath
  const trimmedPath = absolutePath.trim()
  if (trimmedPath.length === 0) return absolutePath
  const normalizedRoot = workspaceRoot.replace(/\/+$/, '')
  if (normalizedRoot.length === 0) return absolutePath
  if (trimmedPath === normalizedRoot) return '.'
  const prefix = `${normalizedRoot}/`
  if (trimmedPath.startsWith(prefix)) {
    const relative = trimmedPath.slice(prefix.length)
    return relative.length > 0 ? relative : '.'
  }
  return absolutePath
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function relativizeWorkspacePathsInText(
  text: string,
  workspaceRoot: string | undefined
): string {
  if (!workspaceRoot || text.length === 0) return text
  const normalizedRoot = workspaceRoot.replace(/\/+$/, '')
  if (normalizedRoot.length === 0) return text
  const pattern = new RegExp(
    `${escapeForRegExp(normalizedRoot)}(?![A-Za-z0-9_-])(/[^\\s'"\`]*)?`,
    'g'
  )
  return text.replace(pattern, (_match, rest: string | undefined) => {
    if (!rest || rest === '/') return '.'
    return rest.slice(1)
  })
}
