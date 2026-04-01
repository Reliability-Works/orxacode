import type {
  BootstrapState,
  ClaudeSectionState,
  CodexSectionState,
  OpenCodeAgentsState,
} from './hooks'
import {
  SettingsSectionContent,
  type SettingsSectionContentProps,
} from './content'
import {
  formatUpdateCheckStatus,
  type SettingsDrawerProps,
  type SettingsSection,
  type UpdateCheckStatus,
} from './types'

type ResolvedSettingsSectionContentProps = {
  section: SettingsSection
  appVersion: string
  effectiveScope: 'project' | 'global'
  setScope: (next: 'project' | 'global') => void
  checkingForUpdates: boolean
  setCheckingForUpdates: (next: boolean) => void
  updateCheckStatus: UpdateCheckStatus | null
  updateUpdateCheckStatus: (status: UpdateCheckStatus) => void
  setFeedback: (message: string | null) => void
  settings: Pick<
    SettingsDrawerProps,
    | 'directory'
    | 'onWriteRaw'
    | 'onReadRaw'
    | 'onWriteGlobalAgentsMd'
    | 'onReadGlobalAgentsMd'
    | 'appPreferences'
    | 'onAppPreferencesChange'
    | 'onGetServerDiagnostics'
    | 'onRepairRuntime'
    | 'onSetUpdatePreferences'
    | 'onCheckForUpdates'
    | 'allModelOptions'
    | 'profiles'
    | 'runtime'
    | 'onSaveProfile'
    | 'onDeleteProfile'
    | 'onAttachProfile'
    | 'onStartLocalProfile'
    | 'onStopLocalProfile'
    | 'onRefreshProfiles'
  >
  bootstrap: BootstrapState
  claudeSection: ClaudeSectionState
  codexSection: CodexSectionState
  openCodeAgents: OpenCodeAgentsState
  openEditor: () => void
  collapsedProviders: Record<string, boolean>
  setCollapsedProviders: (
    next:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void
}

const noop = () => undefined
const asyncNoop = async () => undefined

const emptyProviderStateProps: Pick<
  SettingsSectionContentProps,
  | 'claudeLoading'
  | 'claudeSettingsJson'
  | 'setClaudeSettingsJson'
  | 'claudeMd'
  | 'setClaudeMd'
  | 'codexState'
  | 'codexDoctorRunning'
  | 'setCodexDoctorRunning'
  | 'codexDoctorResult'
  | 'setCodexDoctorResult'
  | 'codexUpdateRunning'
  | 'setCodexUpdateRunning'
  | 'codexUpdateResult'
  | 'setCodexUpdateResult'
  | 'codexModels'
  | 'codexModelsLoading'
  | 'setCodexModelsLoading'
  | 'setCodexModels'
  | 'codexLoading'
  | 'codexConfigToml'
  | 'setCodexConfigToml'
  | 'codexAgentsMd'
  | 'setCodexAgentsMd'
  | 'ocAgents'
  | 'selectedOcAgent'
  | 'setSelectedOcAgent'
  | 'ocAgentDraft'
  | 'setOcAgentDraft'
  | 'ocAgentSaving'
  | 'setOcAgentSaving'
  | 'ocOpenInMenu'
  | 'setOcOpenInMenu'
  | 'loadOcAgents'
  | 'setOcFilenameDialog'
  | 'setOcFilenameValue'
  | 'setOcFilenameError'
> = {
  claudeLoading: false,
  claudeSettingsJson: '',
  setClaudeSettingsJson: noop,
  claudeMd: '',
  setClaudeMd: noop,
  codexState: null,
  codexDoctorRunning: false,
  setCodexDoctorRunning: noop,
  codexDoctorResult: null,
  setCodexDoctorResult: noop,
  codexUpdateRunning: false,
  setCodexUpdateRunning: noop,
  codexUpdateResult: null,
  setCodexUpdateResult: noop,
  codexModels: [],
  codexModelsLoading: false,
  setCodexModelsLoading: noop,
  setCodexModels: noop,
  codexLoading: false,
  codexConfigToml: '',
  setCodexConfigToml: noop,
  codexAgentsMd: '',
  setCodexAgentsMd: noop,
  ocAgents: [],
  selectedOcAgent: undefined,
  setSelectedOcAgent: noop,
  ocAgentDraft: '',
  setOcAgentDraft: noop,
  ocAgentSaving: false,
  setOcAgentSaving: noop,
  ocOpenInMenu: false,
  setOcOpenInMenu: noop,
  loadOcAgents: asyncNoop,
  setOcFilenameDialog: noop,
  setOcFilenameValue: noop,
  setOcFilenameError: noop,
}

function buildCommonResolvedContentProps({
  section,
  appVersion,
  effectiveScope,
  setScope,
  checkingForUpdates,
  setCheckingForUpdates,
  updateCheckStatus,
  updateUpdateCheckStatus,
  setFeedback,
  settings,
  bootstrap,
  openEditor,
  collapsedProviders,
  setCollapsedProviders,
}: ResolvedSettingsSectionContentProps): Omit<
  SettingsSectionContentProps,
  keyof typeof emptyProviderStateProps
> {
  return {
    section,
    appPreferences: settings.appPreferences,
    onAppPreferencesChange: settings.onAppPreferencesChange,
    updatePreferences: bootstrap.updatePreferences,
    onSetUpdatePreferences: settings.onSetUpdatePreferences,
    checkingForUpdates,
    setCheckingForUpdates,
    onCheckForUpdates: settings.onCheckForUpdates,
    updateUpdateCheckStatus,
    setFeedback,
    updateCheckStatus,
    formatUpdateCheckStatus,
    setUpdatePreferences: bootstrap.setUpdatePreferences,
    appVersion,
    serverDiagnostics: bootstrap.serverDiagnostics,
    onGetServerDiagnostics: settings.onGetServerDiagnostics,
    onRepairRuntime: settings.onRepairRuntime,
    setServerDiagnostics: bootstrap.setServerDiagnostics,
    profiles: settings.profiles,
    runtime: settings.runtime,
    onSaveProfile: settings.onSaveProfile,
    onDeleteProfile: settings.onDeleteProfile,
    onAttachProfile: settings.onAttachProfile,
    onStartLocalProfile: settings.onStartLocalProfile,
    onStopLocalProfile: settings.onStopLocalProfile,
    onRefreshProfiles: settings.onRefreshProfiles,
    effectiveScope,
    directory: settings.directory,
    setScope,
    openEditor,
    rawDoc: bootstrap.rawDoc,
    rawText: bootstrap.rawText,
    setRawText: bootstrap.setRawText,
    onWriteRaw: settings.onWriteRaw,
    setRawDoc: bootstrap.setRawDoc,
    onReadRaw: settings.onReadRaw,
    allModelOptions: settings.allModelOptions,
    collapsedProviders,
    setCollapsedProviders,
    globalAgentsDoc: bootstrap.globalAgentsDoc,
    globalAgentsText: bootstrap.globalAgentsText,
    setGlobalAgentsText: bootstrap.setGlobalAgentsText,
    onWriteGlobalAgentsMd: settings.onWriteGlobalAgentsMd,
    onReadGlobalAgentsMd: settings.onReadGlobalAgentsMd,
    setGlobalAgentsDoc: bootstrap.setGlobalAgentsDoc,
  }
}

function buildConnectedProviderStateProps({
  claudeSection,
  codexSection,
  openCodeAgents,
}: ResolvedSettingsSectionContentProps) {
  return {
    claudeLoading: claudeSection.claudeLoading,
    claudeSettingsJson: claudeSection.claudeSettingsJson,
    setClaudeSettingsJson: claudeSection.setClaudeSettingsJson,
    claudeMd: claudeSection.claudeMd,
    setClaudeMd: claudeSection.setClaudeMd,
    codexState: codexSection.codexState,
    codexDoctorRunning: codexSection.codexDoctorRunning,
    setCodexDoctorRunning: codexSection.setCodexDoctorRunning,
    codexDoctorResult: codexSection.codexDoctorResult,
    setCodexDoctorResult: codexSection.setCodexDoctorResult,
    codexUpdateRunning: codexSection.codexUpdateRunning,
    setCodexUpdateRunning: codexSection.setCodexUpdateRunning,
    codexUpdateResult: codexSection.codexUpdateResult,
    setCodexUpdateResult: codexSection.setCodexUpdateResult,
    codexModels: codexSection.codexModels,
    codexModelsLoading: codexSection.codexModelsLoading,
    setCodexModelsLoading: codexSection.setCodexModelsLoading,
    setCodexModels: codexSection.setCodexModels,
    codexLoading: codexSection.codexLoading,
    codexConfigToml: codexSection.codexConfigToml,
    setCodexConfigToml: codexSection.setCodexConfigToml,
    codexAgentsMd: codexSection.codexAgentsMd,
    setCodexAgentsMd: codexSection.setCodexAgentsMd,
    ocAgents: openCodeAgents.ocAgents,
    selectedOcAgent: openCodeAgents.selectedOcAgent,
    setSelectedOcAgent: openCodeAgents.setSelectedOcAgent,
    ocAgentDraft: openCodeAgents.ocAgentDraft,
    setOcAgentDraft: openCodeAgents.setOcAgentDraft,
    ocAgentSaving: openCodeAgents.ocAgentSaving,
    setOcAgentSaving: openCodeAgents.setOcAgentSaving,
    ocOpenInMenu: openCodeAgents.ocOpenInMenu,
    setOcOpenInMenu: openCodeAgents.setOcOpenInMenu,
    loadOcAgents: openCodeAgents.loadOcAgents,
    setOcFilenameDialog: openCodeAgents.setOcFilenameDialog,
    setOcFilenameValue: openCodeAgents.setOcFilenameValue,
    setOcFilenameError: openCodeAgents.setOcFilenameError,
  }
}

export function ResolvedSettingsSectionContent(props: ResolvedSettingsSectionContentProps) {
  const isConnectedProviderSection =
    props.section === 'claude-config' ||
    props.section === 'claude-personalization' ||
    props.section === 'claude-permissions' ||
    props.section === 'claude-dirs' ||
    props.section === 'codex-general' ||
    props.section === 'codex-models' ||
    props.section === 'codex-access' ||
    props.section === 'codex-config' ||
    props.section === 'codex-personalization' ||
    props.section === 'codex-dirs' ||
    props.section === 'opencode-agents'

  return (
    <SettingsSectionContent
      {...buildCommonResolvedContentProps(props)}
      {...(isConnectedProviderSection
        ? buildConnectedProviderStateProps(props)
        : emptyProviderStateProps)}
    />
  )
}
