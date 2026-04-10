const FRONTMATTER_DELIMITER = '---'

export function describeAgentFileError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export function extractAgentFrontmatter(content: string): string | null {
  const stripped = content.startsWith('\uFEFF') ? content.slice(1) : content
  if (!stripped.startsWith(FRONTMATTER_DELIMITER)) {
    return null
  }
  const afterFirst = stripped.slice(FRONTMATTER_DELIMITER.length)
  const newlineIndex = afterFirst.indexOf('\n')
  if (newlineIndex === -1) {
    return null
  }
  const body = afterFirst.slice(newlineIndex + 1)
  const closingPattern = /\r?\n---\s*(?:\r?\n|$)/
  const match = closingPattern.exec(body)
  if (!match) {
    return null
  }
  return body.slice(0, match.index)
}

export function listFrontmatterEntries(
  block: string
): ReadonlyArray<readonly [key: string, value: string]> {
  const entries: Array<readonly [string, string]> = []
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) {
      continue
    }
    const key = line.slice(0, colonIndex).trim()
    const value = unquoteFrontmatterValue(line.slice(colonIndex + 1).trim())
    if (!value) {
      continue
    }
    entries.push([key, value] as const)
  }
  return entries
}

export function isAgentFileNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

export function unquoteFrontmatterValue(value: string): string {
  if (value.length >= 2) {
    const first = value.charAt(0)
    const last = value.charAt(value.length - 1)
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}
