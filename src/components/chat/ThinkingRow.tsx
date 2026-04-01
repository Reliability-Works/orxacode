import { ThinkingShimmer } from './ThinkingShimmer'
import { MarkdownRenderer } from './MarkdownRenderer'

interface ThinkingRowProps {
  summary?: string
  content?: string
}

function parseThinkingLabel(summary: string) {
  const normalized = summary.trim()
  if (!normalized) {
    return { label: 'Thinking', detail: '' }
  }

  const matched = /^(thinking|working|delegating)(?:\.\.\.)?(?::|\s+-)?\s*(.*)$/i.exec(normalized)
  if (matched) {
    const rawLabel = matched[1] ?? 'Thinking'
    const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1).toLowerCase()
    const detail = (matched[2] ?? '').trim()
    return { label, detail }
  }

  return { label: 'Thinking', detail: normalized }
}

export function ThinkingRow({ summary = '', content = '' }: ThinkingRowProps) {
  const { label, detail } = parseThinkingLabel(summary)
  const hasContent = content.trim().length > 0

  if (!hasContent) {
    return (
      <div className="thinking-inline">
        <ThinkingShimmer label={label} />
        {detail ? <span className="thinking-summary">{detail}</span> : null}
      </div>
    )
  }

  return (
    <details className="message-exploration thinking-disclosure">
      <summary className="message-exploration-summary thinking-disclosure-summary">
        <ThinkingShimmer label={label} />
      </summary>
      <div className="thinking-row-content">
        <div className="thinking-content-md">
          <MarkdownRenderer content={content} />
        </div>
      </div>
    </details>
  )
}
