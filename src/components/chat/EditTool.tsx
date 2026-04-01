import { ToolCallCard, type ToolCallStatus } from './ToolCallCard'
import { DiffBlock } from './DiffBlock'

interface EditToolProps {
  path: string
  status: string
  diff?: string
  insertions?: number
  deletions?: number
  type?: string
  error?: string
}

function buildSubtitle(insertions?: number, deletions?: number): string | undefined {
  const parts: string[] = []
  if (insertions !== undefined) parts.push(`+${insertions}`)
  if (deletions !== undefined) parts.push(`-${deletions}`)
  return parts.length > 0 ? parts.join('  ') : undefined
}

export function EditTool({
  path,
  status,
  diff,
  insertions,
  deletions,
  type,
  error,
}: EditToolProps) {
  const safeStatus = (
    ['pending', 'running', 'completed', 'error'].includes(status) ? status : 'pending'
  ) as ToolCallStatus

  const subtitle = buildSubtitle(insertions, deletions)
  const hasContent = !!(diff || error)

  return (
    <div className="edit-tool">
      <ToolCallCard
        title={path}
        subtitle={subtitle}
        status={safeStatus}
        error={error}
        defaultExpanded={hasContent && status !== 'pending'}
      >
        {diff ? (
          <DiffBlock
            path={path}
            diff={diff}
            insertions={insertions}
            deletions={deletions}
            type={type}
          />
        ) : null}
      </ToolCallCard>
    </div>
  )
}
