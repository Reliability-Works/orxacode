import type {
  AgentsDocument,
  RawConfigDocument,
  RuntimeProfile,
  RuntimeProfileInput,
  RuntimeState,
  ServerDiagnostics,
  UpdatePreferences,
} from '@shared/ipc'
import type { ModelOption } from '../../lib/models'
import type { AppPreferences } from '~/types/app'

export type SettingsDrawerProps = {
  open: boolean
  directory: string | undefined
  onClose: () => void
  onReadRaw: (scope: 'project' | 'global', directory?: string) => Promise<RawConfigDocument>
  onWriteRaw: (
    scope: 'project' | 'global',
    content: string,
    directory?: string
  ) => Promise<RawConfigDocument>
  onReadGlobalAgentsMd: () => Promise<AgentsDocument>
  onWriteGlobalAgentsMd: (content: string) => Promise<AgentsDocument>
  appPreferences: AppPreferences
  onAppPreferencesChange: (next: AppPreferences) => void
  onGetServerDiagnostics: () => Promise<ServerDiagnostics>
  onRepairRuntime: () => Promise<ServerDiagnostics>
  onGetUpdatePreferences: () => Promise<UpdatePreferences>
  onSetUpdatePreferences: (input: Partial<UpdatePreferences>) => Promise<UpdatePreferences>
  onCheckForUpdates: () => Promise<{
    ok: boolean
    status: 'started' | 'skipped' | 'error'
    message?: string
  }>
  allModelOptions: ModelOption[]
  profiles: RuntimeProfile[]
  runtime: RuntimeState
  onSaveProfile: (profile: RuntimeProfileInput) => Promise<void>
  onDeleteProfile: (profileID: string) => Promise<void>
  onAttachProfile: (profileID: string) => Promise<void>
  onStartLocalProfile: (profileID: string) => Promise<void>
  onStopLocalProfile: () => Promise<void>
  onRefreshProfiles: () => Promise<void>
}

export type SettingsSection =
  | 'config'
  | 'provider-models'
  | 'opencode-agents'
  | 'personalization'
  | 'git'
  | 'app'
  | 'appearance'
  | 'preferences'
  | 'server'
  | 'claude-config'
  | 'claude-permissions'
  | 'claude-dirs'
  | 'claude-personalization'
  | 'codex-general'
  | 'codex-models'
  | 'codex-access'
  | 'codex-config'
  | 'codex-personalization'
  | 'codex-dirs'

export type UpdateCheckStatus = {
  checkedAt: number
  state: 'started' | 'skipped' | 'error'
  message?: string
}

export const UPDATE_CHECK_STATUS_KEY = 'orxa:updateCheckStatus:v1'

export function formatUpdateCheckStatus(status: UpdateCheckStatus | null): string {
  if (!status) {
    return 'Last checked: Never'
  }

  const checkedAt = new Date(status.checkedAt)
  const timestamp = Number.isNaN(checkedAt.getTime()) ? 'unknown time' : checkedAt.toLocaleString()

  if (status.message && status.message.trim().length > 0) {
    return `Last checked: ${timestamp} (${status.message.trim()})`
  }
  if (status.state === 'started') {
    return `Last checked: ${timestamp} (Update check started)`
  }
  if (status.state === 'error') {
    return `Last checked: ${timestamp} (Update check failed)`
  }

  return `Last checked: ${timestamp} (Update check skipped)`
}

export type SettingsDrawerFeedbackSetter = (message: string | null) => void
