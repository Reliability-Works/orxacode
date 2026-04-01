const BOOTSTRAP_COMMAND_RE =
  /(?:^|\s)(?:exec\s+)?env\s+-u\s+ANTHROPIC_BASE_URL\s+-u\s+ANTHROPIC_AUTH_TOKEN\s+-u\s+ANTHROPIC_API_KEY\s+claude(?:\s+--dangerously-skip-permissions)?(?:\s|$)/

function stripCursorArtifact(value: string) {
  return value.replace(/\{"cursor":\d+\}/g, '')
}

function normalizeStartupLine(value: string) {
  return stripCursorArtifact(value)
    .replaceAll('\u001b', '')
    .replace(/\[[0-9;?]*[ -/]*[@-~]/g, '')
    .trim()
}

export function consumeClaudeStartupChunk(
  startupBuffer: string[],
  chunk: string,
  startupReady: boolean
): { startupReady: boolean; startupBuffer: string[]; displayChunk: string | null } {
  let pending = `${startupBuffer.join('')}${stripCursorArtifact(chunk)}`
  if (!pending) {
    return { startupReady, startupBuffer: [], displayChunk: null }
  }

  const emittedLines: string[] = []
  let nextStartupReady = startupReady

  while (true) {
    const newlineIndex = pending.search(/\r?\n/)
    if (newlineIndex < 0) break
    const newlineLength =
      pending[newlineIndex] === '\r' && pending[newlineIndex + 1] === '\n' ? 2 : 1
    const line = pending.slice(0, newlineIndex + newlineLength)
    pending = pending.slice(newlineIndex + newlineLength)

    const normalized = normalizeStartupLine(line)
    if (!nextStartupReady && (normalized.length === 0 || BOOTSTRAP_COMMAND_RE.test(normalized))) {
      continue
    }

    nextStartupReady = true
    emittedLines.push(line)
  }

  if (nextStartupReady && pending) {
    emittedLines.push(pending)
    pending = ''
  }

  return {
    startupReady: nextStartupReady,
    startupBuffer: pending ? [pending] : [],
    displayChunk: emittedLines.length > 0 ? emittedLines.join('') : null,
  }
}
