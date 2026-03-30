import { ToolCallCard, type ToolCallStatus } from './ToolCallCard'
import { CommandOutput } from './CommandOutput'
import { stripAnsi } from '../../lib/ansi'

interface BashToolProps {
  command: string
  output?: string
  exitCode?: number
  status: string
  error?: string
}

export function BashTool({ command, output, exitCode, status, error }: BashToolProps) {
  const safeStatus = (
    ['pending', 'running', 'completed', 'error'].includes(status) ? status : 'pending'
  ) as ToolCallStatus

  const cleanOutput = output ? stripAnsi(output) : undefined
  const cleanError = error ? stripAnsi(error) : undefined

  const hasContent = !!(cleanOutput || cleanError)

  return (
    <div className="bash-tool">
      <ToolCallCard title={command} status={safeStatus} defaultExpanded={false} iconHint="bash">
        {hasContent ? (
          <div className="bash-tool-body">
            <CommandOutput
              command={command}
              output={cleanOutput ?? cleanError ?? ''}
              exitCode={exitCode}
            />
            {cleanError ? <pre className="bash-tool-error">{cleanError}</pre> : null}
          </div>
        ) : null}
      </ToolCallCard>
    </div>
  )
}
