import { useClaudeChatSession } from '../hooks/useClaudeChatSession'

type Props = {
  directory: string
  sessionStorageKey: string
}

export function ClaudeChatBackgroundSessionManager({ directory, sessionStorageKey }: Props) {
  useClaudeChatSession(directory, sessionStorageKey)
  return null
}
