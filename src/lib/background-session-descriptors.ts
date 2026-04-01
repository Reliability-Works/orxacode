export type BackgroundSessionDescriptor = {
  key: string
  provider: 'codex' | 'opencode' | 'claude' | 'claude-chat'
  directory: string
  sessionStorageKey?: string
  sessionID?: string
}
