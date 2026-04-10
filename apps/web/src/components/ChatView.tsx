/**
 * ChatView — thin orchestrator.
 *
 * All logic lives in useChatViewController and sibling hook/sub-component
 * files under ./chat/. Sub-components consume state via ChatViewCtx.
 */

import { useChatViewController } from './chat/useChatViewController'
import { ChatViewCtx } from './chat/ChatViewContext'
import { ChatViewEmpty } from './chat/ChatViewEmpty'
import { ChatViewInner } from './chat/ChatViewInner'
import type { ThreadId } from '@orxa-code/contracts'

interface ChatViewProps {
  threadId: ThreadId
  showHeader?: boolean
}

export default function ChatView({ threadId, showHeader = true }: ChatViewProps) {
  const c = useChatViewController(threadId)
  if (!c.td.activeThread) {
    return <ChatViewEmpty />
  }
  return (
    <ChatViewCtx.Provider value={c}>
      <ChatViewInner showHeader={showHeader} />
    </ChatViewCtx.Provider>
  )
}
