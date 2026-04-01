export type ParsedComposerSlashCommand = {
  command: string
  remainder: string
}

export function parseComposerSlashCommand(
  value: string
): ParsedComposerSlashCommand | null {
  const trimmed = value.trim()
  const match = trimmed.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/)
  if (!match) {
    return null
  }
  return {
    command: match[1]!.toLowerCase(),
    remainder: match[2]?.trim() ?? '',
  }
}
