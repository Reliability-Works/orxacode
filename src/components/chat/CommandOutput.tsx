interface CommandOutputProps {
  command: string;
  output: string;
  exitCode?: number;
}

export function CommandOutput({ command, output, exitCode }: CommandOutputProps) {
  return (
    <div className="command-output">
      <div className="command-output-prompt">
        <span className="command-output-prompt-symbol">$</span>
        <span className="command-output-prompt-text">{command}</span>
        {exitCode !== undefined ? (
          <span
            className={`command-output-exit-code ${exitCode === 0 ? "command-output-exit-code--ok" : "command-output-exit-code--err"}`}
          >
            [{exitCode}]
          </span>
        ) : null}
      </div>
      <pre className="command-output-body">{output}</pre>
    </div>
  );
}
