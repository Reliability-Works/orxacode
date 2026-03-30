import { useCodexSession } from '../hooks/useCodexSession'

type Props = {
  directory: string
  sessionStorageKey: string
  codexPath?: string
  codexArgs?: string
}

export function CodexBackgroundSessionManager({
  directory,
  sessionStorageKey,
  codexPath,
  codexArgs,
}: Props) {
  useCodexSession(directory, sessionStorageKey, { codexPath, codexArgs })
  return null
}
