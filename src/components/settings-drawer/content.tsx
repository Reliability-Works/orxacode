import type { Dispatch, SetStateAction } from 'react'
import type {
  AgentsDocument,
  CodexDoctorResult,
  CodexModelEntry,
  CodexUpdateResult,
  OpenCodeAgentFile,
  RawConfigDocument,
  RuntimeProfile,
  RuntimeProfileInput,
  RuntimeState,
  ServerDiagnostics,
  UpdatePreferences,
} from '@shared/ipc'
import type { AppPreferences } from '~/types/app'
import type { ModelOption } from '../../lib/models'
import {
  AppearanceSection,
  AppSettingsSection,
  ConfigSection,
  GitSettingsSection,
  PersonalizationSection,
  PreferencesSection,
  ServerSection,
} from './core-sections'
import {
  ClaudeConfigSection,
  ClaudeDirsSection,
  ClaudePermissionsSection,
  ClaudePersonalizationSection,
} from './claude-sections'
import {
  CodexAccessSection,
  CodexConfigSection,
  CodexDirsSection,
  CodexGeneralSection,
  CodexModelsSection,
  CodexPersonalizationSection,
} from './codex-sections'
import type { OcAgentFilenameDialog } from './opencode-agents-section'
import { OpenCodeAgentsSection } from './opencode-agents-section'
import { ProviderModelsSection } from './provider-models-section'
import {
  type SettingsSection,
  type UpdateCheckStatus,
} from './types'

export type SettingsSectionContentProps = {
  section: SettingsSection
  appPreferences: AppPreferences
  onAppPreferencesChange: (next: AppPreferences) => void
  updatePreferences: UpdatePreferences
  onSetUpdatePreferences: (input: Partial<UpdatePreferences>) => Promise<UpdatePreferences>
  checkingForUpdates: boolean
  setCheckingForUpdates: (next: boolean) => void
  onCheckForUpdates: () => Promise<{
    ok: boolean
    status: 'started' | 'skipped' | 'error'
    message?: string
  }>
  updateUpdateCheckStatus: (status: UpdateCheckStatus) => void
  setFeedback: (message: string | null) => void
  updateCheckStatus: UpdateCheckStatus | null
  formatUpdateCheckStatus: (status: UpdateCheckStatus | null) => string
  setUpdatePreferences: (next: UpdatePreferences) => void
  appVersion: string
  serverDiagnostics: ServerDiagnostics | null
  onGetServerDiagnostics: () => Promise<ServerDiagnostics>
  onRepairRuntime: () => Promise<ServerDiagnostics>
  setServerDiagnostics: (next: ServerDiagnostics | null) => void
  profiles: RuntimeProfile[]
  runtime: RuntimeState
  onSaveProfile: (profile: RuntimeProfileInput) => Promise<void>
  onDeleteProfile: (profileID: string) => Promise<void>
  onAttachProfile: (profileID: string) => Promise<void>
  onStartLocalProfile: (profileID: string) => Promise<void>
  onStopLocalProfile: () => Promise<void>
  onRefreshProfiles: () => Promise<void>
  effectiveScope: 'project' | 'global'
  directory: string | undefined
  setScope: (next: 'project' | 'global') => void
  openEditor: () => void
  rawDoc: RawConfigDocument | null
  rawText: string
  setRawText: (next: string) => void
  onWriteRaw: (
    scope: 'project' | 'global',
    content: string,
    directory?: string
  ) => Promise<RawConfigDocument>
  setRawDoc: (next: RawConfigDocument | null) => void
  onReadRaw: (scope: 'project' | 'global', directory?: string) => Promise<RawConfigDocument>
  allModelOptions: ModelOption[]
  collapsedProviders: Record<string, boolean>
  setCollapsedProviders: (
    next:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void
  globalAgentsDoc: AgentsDocument | null
  globalAgentsText: string
  setGlobalAgentsText: (next: string) => void
  onWriteGlobalAgentsMd: (content: string) => Promise<AgentsDocument>
  onReadGlobalAgentsMd: () => Promise<AgentsDocument>
  setGlobalAgentsDoc: (next: AgentsDocument | null) => void
  claudeLoading: boolean
  claudeSettingsJson: string
  setClaudeSettingsJson: (next: string) => void
  claudeMd: string
  setClaudeMd: (next: string) => void
  codexState: { status: string } | null
  codexDoctorRunning: boolean
  setCodexDoctorRunning: (next: boolean) => void
  codexDoctorResult: CodexDoctorResult | null
  setCodexDoctorResult: (next: CodexDoctorResult | null) => void
  codexUpdateRunning: boolean
  setCodexUpdateRunning: (next: boolean) => void
  codexUpdateResult: CodexUpdateResult | null
  setCodexUpdateResult: (next: CodexUpdateResult | null) => void
  codexModels: CodexModelEntry[]
  codexModelsLoading: boolean
  setCodexModelsLoading: (next: boolean) => void
  setCodexModels: Dispatch<SetStateAction<CodexModelEntry[]>>
  codexLoading: boolean
  codexConfigToml: string
  setCodexConfigToml: (next: string) => void
  codexAgentsMd: string
  setCodexAgentsMd: (next: string) => void
  ocAgents: OpenCodeAgentFile[]
  selectedOcAgent: string | undefined
  setSelectedOcAgent: (next: string | undefined) => void
  ocAgentDraft: string
  setOcAgentDraft: (next: string) => void
  ocAgentSaving: boolean
  setOcAgentSaving: (next: boolean) => void
  ocOpenInMenu: boolean
  setOcOpenInMenu: (next: boolean | ((prev: boolean) => boolean)) => void
  loadOcAgents: () => Promise<void>
  setOcFilenameDialog: (dialog: OcAgentFilenameDialog) => void
  setOcFilenameValue: (next: string) => void
  setOcFilenameError: (next: string | null) => void
}

function renderOrxaSectionContent(props: SettingsSectionContentProps) {
  const {
    section,
    appPreferences,
    onAppPreferencesChange,
    updatePreferences,
    onSetUpdatePreferences,
    checkingForUpdates,
    setCheckingForUpdates,
    onCheckForUpdates,
    updateUpdateCheckStatus,
    setFeedback,
    updateCheckStatus,
    formatUpdateCheckStatus,
    setUpdatePreferences,
    appVersion,
  } = props

  switch (section) {
    case 'app':
      return (
        <AppSettingsSection
          appPreferences={appPreferences}
          onAppPreferencesChange={onAppPreferencesChange}
          updatePreferences={updatePreferences}
          onSetUpdatePreferences={onSetUpdatePreferences}
          checkingForUpdates={checkingForUpdates}
          setCheckingForUpdates={setCheckingForUpdates}
          onCheckForUpdates={onCheckForUpdates}
          updateUpdateCheckStatus={updateUpdateCheckStatus}
          setFeedback={setFeedback}
          updateCheckStatus={updateCheckStatus}
          formatUpdateCheckStatus={formatUpdateCheckStatus}
          setUpdatePreferences={setUpdatePreferences}
          appVersion={appVersion}
        />
      )
    case 'appearance':
      return (
        <AppearanceSection
          appPreferences={appPreferences}
          onAppPreferencesChange={onAppPreferencesChange}
        />
      )
    case 'git':
      return (
        <GitSettingsSection
          appPreferences={appPreferences}
          onAppPreferencesChange={onAppPreferencesChange}
        />
      )
    case 'preferences':
      return (
        <PreferencesSection
          appPreferences={appPreferences}
          onAppPreferencesChange={onAppPreferencesChange}
        />
      )
    default:
      return null
  }
}

function renderWorkspaceSectionContent(props: SettingsSectionContentProps) {
  const {
    section,
    globalAgentsDoc,
    globalAgentsText,
    setGlobalAgentsText,
    onWriteGlobalAgentsMd,
    onReadGlobalAgentsMd,
    setGlobalAgentsDoc,
    setFeedback,
    serverDiagnostics,
    onGetServerDiagnostics,
    onRepairRuntime,
    setServerDiagnostics,
    profiles,
    runtime,
    onSaveProfile,
    onDeleteProfile,
    onAttachProfile,
    onStartLocalProfile,
    onStopLocalProfile,
    onRefreshProfiles,
  } = props

  if (section === 'personalization') {
    return (
      <PersonalizationSection
        globalAgentsDoc={globalAgentsDoc}
        globalAgentsText={globalAgentsText}
        setGlobalAgentsText={setGlobalAgentsText}
        onWriteGlobalAgentsMd={onWriteGlobalAgentsMd}
        onReadGlobalAgentsMd={onReadGlobalAgentsMd}
        setGlobalAgentsDoc={setGlobalAgentsDoc}
        setFeedback={setFeedback}
      />
    )
  }

  if (section === 'server') {
    return (
      <ServerSection
        serverDiagnostics={serverDiagnostics}
        onGetServerDiagnostics={onGetServerDiagnostics}
        onRepairRuntime={onRepairRuntime}
        setServerDiagnostics={setServerDiagnostics}
        setFeedback={setFeedback}
        profiles={profiles}
        runtime={runtime}
        onSaveProfile={onSaveProfile}
        onDeleteProfile={onDeleteProfile}
        onAttachProfile={onAttachProfile}
        onStartLocalProfile={onStartLocalProfile}
        onStopLocalProfile={onStopLocalProfile}
        onRefreshProfiles={onRefreshProfiles}
      />
    )
  }

  return null
}

function renderOpenCodeSectionContent(props: SettingsSectionContentProps) {
  const {
    section,
    effectiveScope,
    directory,
    setScope,
    openEditor,
    rawDoc,
    rawText,
    setRawText,
    onWriteRaw,
    setRawDoc,
    setFeedback,
    onReadRaw,
    allModelOptions,
    appPreferences,
    onAppPreferencesChange,
    collapsedProviders,
    setCollapsedProviders,
    ocAgents,
    selectedOcAgent,
    setSelectedOcAgent,
    ocAgentDraft,
    setOcAgentDraft,
    ocAgentSaving,
    setOcAgentSaving,
    ocOpenInMenu,
    setOcOpenInMenu,
    loadOcAgents,
    setOcFilenameDialog,
    setOcFilenameValue,
    setOcFilenameError,
  } = props

  switch (section) {
    case 'config':
      return (
        <ConfigSection
          effectiveScope={effectiveScope}
          directory={directory}
          setScope={setScope}
          openEditor={openEditor}
          rawDoc={rawDoc}
          rawText={rawText}
          setRawText={setRawText}
          onWriteRaw={onWriteRaw}
          setRawDoc={setRawDoc}
          setFeedback={setFeedback}
          onReadRaw={onReadRaw}
        />
      )
    case 'provider-models':
      return (
        <ProviderModelsSection
          allModelOptions={allModelOptions}
          appPreferences={appPreferences}
          onAppPreferencesChange={onAppPreferencesChange}
          collapsedProviders={collapsedProviders}
          setCollapsedProviders={setCollapsedProviders}
        />
      )
    case 'opencode-agents':
      return (
        <OpenCodeAgentsSection
          ocAgents={ocAgents}
          selectedOcAgent={selectedOcAgent}
          setSelectedOcAgent={setSelectedOcAgent}
          ocAgentDraft={ocAgentDraft}
          setOcAgentDraft={setOcAgentDraft}
          ocAgentSaving={ocAgentSaving}
          setOcAgentSaving={setOcAgentSaving}
          ocOpenInMenu={ocOpenInMenu}
          setOcOpenInMenu={setOcOpenInMenu}
          setFeedback={setFeedback}
          loadOcAgents={loadOcAgents}
          setOcFilenameDialog={setOcFilenameDialog}
          setOcFilenameValue={setOcFilenameValue}
          setOcFilenameError={setOcFilenameError}
        />
      )
    default:
      return null
  }
}

function renderClaudeSectionContent(props: SettingsSectionContentProps) {
  const {
    section,
    claudeLoading,
    claudeSettingsJson,
    setClaudeSettingsJson,
    setFeedback,
    claudeMd,
    setClaudeMd,
    appPreferences,
    onAppPreferencesChange,
  } = props

  switch (section) {
    case 'claude-config':
      return (
        <ClaudeConfigSection
          claudeLoading={claudeLoading}
          claudeSettingsJson={claudeSettingsJson}
          setClaudeSettingsJson={setClaudeSettingsJson}
          setFeedback={setFeedback}
        />
      )
    case 'claude-personalization':
      return (
        <ClaudePersonalizationSection
          claudeLoading={claudeLoading}
          claudeMd={claudeMd}
          setClaudeMd={setClaudeMd}
          setFeedback={setFeedback}
        />
      )
    case 'claude-permissions':
      return (
        <ClaudePermissionsSection
          appPreferences={appPreferences}
          onAppPreferencesChange={onAppPreferencesChange}
        />
      )
    case 'claude-dirs':
      return <ClaudeDirsSection />
    default:
      return null
  }
}

function renderCodexSectionContent(props: SettingsSectionContentProps) {
  const {
    section,
    appPreferences,
    onAppPreferencesChange,
    codexState,
    codexDoctorRunning,
    setCodexDoctorRunning,
    codexDoctorResult,
    setCodexDoctorResult,
    codexUpdateRunning,
    setCodexUpdateRunning,
    codexUpdateResult,
    setCodexUpdateResult,
    setFeedback,
    codexModels,
    codexModelsLoading,
    setCodexModelsLoading,
    setCodexModels,
    codexLoading,
    codexConfigToml,
    setCodexConfigToml,
    codexAgentsMd,
    setCodexAgentsMd,
  } = props

  switch (section) {
    case 'codex-general':
      return (
        <CodexGeneralSection
          appPreferences={appPreferences}
          onAppPreferencesChange={onAppPreferencesChange}
          codexState={codexState}
          codexDoctorRunning={codexDoctorRunning}
          setCodexDoctorRunning={setCodexDoctorRunning}
          codexDoctorResult={codexDoctorResult}
          setCodexDoctorResult={setCodexDoctorResult}
          codexUpdateRunning={codexUpdateRunning}
          setCodexUpdateRunning={setCodexUpdateRunning}
          codexUpdateResult={codexUpdateResult}
          setCodexUpdateResult={setCodexUpdateResult}
          setFeedback={setFeedback}
        />
      )
    case 'codex-models':
      return (
        <CodexModelsSection
          appPreferences={appPreferences}
          onAppPreferencesChange={onAppPreferencesChange}
          codexModels={codexModels}
          codexModelsLoading={codexModelsLoading}
          setCodexModelsLoading={setCodexModelsLoading}
          setCodexModels={setCodexModels}
          setFeedback={setFeedback}
        />
      )
    case 'codex-access':
      return (
        <CodexAccessSection
          appPreferences={appPreferences}
          onAppPreferencesChange={onAppPreferencesChange}
        />
      )
    case 'codex-config':
      return (
        <CodexConfigSection
          codexLoading={codexLoading}
          codexConfigToml={codexConfigToml}
          setCodexConfigToml={setCodexConfigToml}
          setFeedback={setFeedback}
        />
      )
    case 'codex-personalization':
      return (
        <CodexPersonalizationSection
          codexLoading={codexLoading}
          codexAgentsMd={codexAgentsMd}
          setCodexAgentsMd={setCodexAgentsMd}
          setFeedback={setFeedback}
        />
      )
    case 'codex-dirs':
      return <CodexDirsSection />
    default:
      return null
  }
}

export function SettingsSectionContent(props: SettingsSectionContentProps) {
  return (
    renderOrxaSectionContent(props) ??
    renderWorkspaceSectionContent(props) ??
    renderOpenCodeSectionContent(props) ??
    renderClaudeSectionContent(props) ??
    renderCodexSectionContent(props)
  )
}
