import { MarkdownRenderer } from './MarkdownRenderer'
import { CopyButton } from './CopyButton'

interface TextPartProps {
  content: string
  showCopy?: boolean
  role?: 'user' | 'assistant'
  onOpenFileReference?: (reference: string) => void
}

export function TextPart({ content, showCopy, role, onOpenFileReference }: TextPartProps) {
  return (
    <div className={`text-part${role ? ` text-part--${role}` : ''}`}>
      <div className="text-part-body part-text part-text-md">
        <MarkdownRenderer content={content} onOpenFileReference={onOpenFileReference} />
      </div>
      {showCopy ? <CopyButton text={content} className="text-part-copy" /> : null}
    </div>
  )
}
