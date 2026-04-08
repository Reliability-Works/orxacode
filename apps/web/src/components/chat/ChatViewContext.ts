/**
 * Context for sharing ChatView state across sub-components.
 *
 * Sub-components use useChatViewCtx() instead of receiving c as a prop.
 * This avoids the React Compiler react-hooks/refs rule which flags
 * ref-touching values passed through JSX props.
 */

import { createContext, useContext } from 'react'
import type { useChatViewController } from './useChatViewController'

export type ChatViewCtxValue = ReturnType<typeof useChatViewController>

export const ChatViewCtx = createContext<ChatViewCtxValue | null>(null)

export function useChatViewCtx(): ChatViewCtxValue {
  const ctx = useContext(ChatViewCtx)
  if (ctx === null) throw new Error('useChatViewCtx must be used within ChatViewCtx.Provider')
  return ctx
}
