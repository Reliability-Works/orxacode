import { useState } from 'react'
import {
  useClaudeSectionData,
  useCodexSectionData,
  useEffectiveScope,
  useOpenCodeAgentsState,
  useSettingsBootstrap,
  useUpdateCheckStatus,
} from './settings-drawer/hooks'
import { SettingsDrawerLayout } from './settings-drawer/layout'
import { SettingsDrawerOverlays } from './settings-drawer/overlays'
import { ResolvedSettingsSectionContent } from './settings-drawer/resolved-content'
import {
  type SettingsDrawerProps as Props,
  type SettingsSection,
} from './settings-drawer/types'

export type { Props }

function createResolvedContentSettings(props: Props) {
  const {
    directory,
    onWriteRaw,
    onReadRaw,
    onWriteGlobalAgentsMd,
    onReadGlobalAgentsMd,
    appPreferences,
    onAppPreferencesChange,
    onGetServerDiagnostics,
    onRepairRuntime,
    onSetUpdatePreferences,
    onCheckForUpdates,
    allModelOptions,
    profiles,
    runtime,
    onSaveProfile,
    onDeleteProfile,
    onAttachProfile,
    onStartLocalProfile,
    onStopLocalProfile,
    onRefreshProfiles,
  } = props

  return {
    directory,
    onWriteRaw,
    onReadRaw,
    onWriteGlobalAgentsMd,
    onReadGlobalAgentsMd,
    appPreferences,
    onAppPreferencesChange,
    onGetServerDiagnostics,
    onRepairRuntime,
    onSetUpdatePreferences,
    onCheckForUpdates,
    allModelOptions,
    profiles,
    runtime,
    onSaveProfile,
    onDeleteProfile,
    onAttachProfile,
    onStartLocalProfile,
    onStopLocalProfile,
    onRefreshProfiles,
  }
}

export function SettingsDrawer(props: Props) {
  const appVersion = APP_VERSION?.trim().length ? APP_VERSION : 'dev'
  const [section, setSection] = useState<SettingsSection>('app')
  const [scope, setScope] = useState<'project' | 'global'>('global')
  const [checkingForUpdates, setCheckingForUpdates] = useState(false)
  const [collapsedProviders, setCollapsedProviders] = useState<Record<string, boolean>>({})
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorText, setEditorText] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [feedback, setFeedback] = useState<string | null>(null)

  const effectiveScope = useEffectiveScope(scope, props.directory)
  const { updateCheckStatus, updateUpdateCheckStatus } = useUpdateCheckStatus()
  const bootstrap = useSettingsBootstrap(
    {
      open: props.open,
      effectiveScope,
      directory: props.directory,
      onReadRaw: props.onReadRaw,
      onReadGlobalAgentsMd: props.onReadGlobalAgentsMd,
      onGetServerDiagnostics: props.onGetServerDiagnostics,
      onGetUpdatePreferences: props.onGetUpdatePreferences,
    },
    setFeedback
  )
  const openCodeAgents = useOpenCodeAgentsState({ open: props.open, section }, setFeedback)
  const claudeSection = useClaudeSectionData({ open: props.open, section }, setFeedback)
  const codexSection = useCodexSectionData({ open: props.open, section }, setFeedback)

  if (!props.open) {
    return null
  }

  const openEditor = () => {
    setEditorText(bootstrap.rawText)
    setEditorOpen(true)
  }

  const saveEditor = () =>
    props.onWriteRaw(effectiveScope, editorText, props.directory).then(next => {
      bootstrap.setRawDoc(next)
      bootstrap.setRawText(next.content)
      setFeedback('OpenCode config saved')
      setEditorOpen(false)
    })

  const reloadEditor = () => {
    void props.onReadRaw(effectiveScope, props.directory).then(next => {
      setEditorText(next.content)
    })
  }

  const settings = createResolvedContentSettings(props)

  return (
    <>
      <SettingsDrawerLayout
        section={section}
        onClose={props.onClose}
        setSection={setSection}
        collapsedGroups={collapsedGroups}
        setCollapsedGroups={setCollapsedGroups}
        feedback={feedback}
      >
        <ResolvedSettingsSectionContent
          section={section}
          appVersion={appVersion}
          effectiveScope={effectiveScope}
          setScope={setScope}
          checkingForUpdates={checkingForUpdates}
          setCheckingForUpdates={setCheckingForUpdates}
          updateCheckStatus={updateCheckStatus}
          updateUpdateCheckStatus={updateUpdateCheckStatus}
          setFeedback={setFeedback}
          settings={settings}
          bootstrap={bootstrap}
          claudeSection={claudeSection}
          codexSection={codexSection}
          openCodeAgents={openCodeAgents}
          openEditor={openEditor}
          collapsedProviders={collapsedProviders}
          setCollapsedProviders={setCollapsedProviders}
        />
      </SettingsDrawerLayout>

      <SettingsDrawerOverlays
        openCodeAgents={openCodeAgents}
        editorOpen={editorOpen}
        editorText={editorText}
        setEditorText={setEditorText}
        bootstrap={bootstrap}
        onCloseEditor={() => setEditorOpen(false)}
        onSaveEditor={() =>
          void saveEditor().catch((error: unknown) => {
            setFeedback(error instanceof Error ? error.message : String(error))
          })
        }
        onReloadEditor={reloadEditor}
      />
    </>
  )
}
