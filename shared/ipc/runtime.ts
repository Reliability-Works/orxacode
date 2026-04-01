export type RuntimeProfile = {
  id: string
  name: string
  host: string
  port: number
  https: boolean
  username?: string
  hasPassword: boolean
  startCommand: boolean
  startHost: string
  startPort: number
  cliPath?: string
  corsOrigins: string[]
}

export type RuntimeProfileInput = Omit<RuntimeProfile, 'id' | 'hasPassword'> & {
  id?: string
  password?: string
}

export type RuntimeConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'starting'
  | 'error'

export type RuntimeState = {
  status: RuntimeConnectionStatus
  activeProfileId?: string
  baseUrl?: string
  managedServer: boolean
  lastError?: string
}

export type RuntimeDependency = {
  key: 'opencode' | 'orxa'
  label: string
  required: boolean
  installed: boolean
  description: string
  reason: string
  installCommand: string
  sourceUrl: string
}

export type RuntimeDependencyReport = {
  checkedAt: number
  dependencies: RuntimeDependency[]
  missingAny: boolean
  missingRequired: boolean
}

export type ServerDiagnostics = {
  runtime: RuntimeState
  activeProfile?: RuntimeProfile
  health: 'connected' | 'disconnected' | 'error'
  lastError?: string
}
