/**
 * Context-aware wrapper around ChatViewImageOverlay.
 *
 * Extracted from ChatView.tsx so the root shell can mount it via JSX without
 * threading ref-touching values through props.
 */

import { ChatViewImageOverlay } from './ChatViewImageOverlay'
import { useChatViewCtx } from './ChatViewContext'

export function ChatViewImageOverlayCtx() {
  const c = useChatViewCtx()
  const { expandedImage } = c.ls
  if (!expandedImage) return null
  return (
    <ChatViewImageOverlay
      expandedImage={expandedImage}
      onClose={c.closeExpandedImage}
      onNavigate={c.navigateExpandedImage}
    />
  )
}
