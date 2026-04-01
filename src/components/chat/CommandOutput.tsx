interface CommandOutputProps {
  command: string
  output: string
  exitCode?: number
  hidePrompt?: boolean
}

const MAX_COMMAND_OUTPUT_LINES = 200

export function CommandOutput({
  command,
  output,
  exitCode,
  hidePrompt = false,
}: CommandOutputProps) {
  const lines = output.split('\n')
  const isTruncated = lines.length > MAX_COMMAND_OUTPUT_LINES
  const visibleOutput = isTruncated
    ? lines.slice(lines.length - MAX_COMMAND_OUTPUT_LINES).join('\n')
    : output
  const hasVisibleOutput = visibleOutput.trim().length > 0

  return (
    <div className="command-output">
      {!hidePrompt ? (
        <div className="command-output-prompt">
          <span className="command-output-prompt-symbol">$</span>
          <span className="command-output-prompt-text">{command}</span>
          {exitCode !== undefined ? (
            <span
              className={`command-output-exit-code ${exitCode === 0 ? 'command-output-exit-code--ok' : 'command-output-exit-code--err'}`}
            >
              [{exitCode}]
            </span>
          ) : null}
          {isTruncated ? (
            <span className="command-output-exit-code">tail {MAX_COMMAND_OUTPUT_LINES}</span>
          ) : null}
        </div>
      ) : null}
      {hasVisibleOutput ? <pre className="command-output-body">{visibleOutput}</pre> : null}
    </div>
  )
}
