import { createContext, useContext } from 'react'

export type ChatSplitPane = 'primary' | 'secondary'

export interface ChatSplitPaneControls {
  readonly pane: ChatSplitPane
  readonly splitOpen: boolean
  readonly focusedPane: ChatSplitPane
  readonly maximizedPane: ChatSplitPane | null
  readonly toggleSplit: () => void
  readonly focusPane: () => void
  readonly toggleMaximize: () => void
}

export const ChatSplitPaneContext = createContext<ChatSplitPaneControls | null>(null)

export function useChatSplitPaneContext(): ChatSplitPaneControls | null {
  return useContext(ChatSplitPaneContext)
}
