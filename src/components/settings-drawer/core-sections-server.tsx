import { useEffect, useMemo, useState } from 'react'
import type { RuntimeProfile, RuntimeProfileInput, RuntimeState, ServerDiagnostics } from '@shared/ipc'
import {
  LocalRuntimeSection,
  RemoteProfilesSection,
} from './core-sections-server-ui'

type ServerSectionProps = {
  serverDiagnostics: ServerDiagnostics | null
  onGetServerDiagnostics: () => Promise<ServerDiagnostics>
  onRepairRuntime: () => Promise<ServerDiagnostics>
  setServerDiagnostics: (diagnostics: ServerDiagnostics) => void
  setFeedback: (message: string) => void
  profiles: RuntimeProfile[]
  runtime: RuntimeState
  onSaveProfile: (profile: RuntimeProfileInput) => Promise<void>
  onDeleteProfile: (profileID: string) => Promise<void>
  onAttachProfile: (profileID: string) => Promise<void>
  onStartLocalProfile: (profileID: string) => Promise<void>
  onStopLocalProfile: () => Promise<void>
  onRefreshProfiles: () => Promise<void>
}

export function ServerSection({
  serverDiagnostics,
  onGetServerDiagnostics,
  onRepairRuntime,
  setServerDiagnostics,
  setFeedback,
  profiles,
  runtime,
  onSaveProfile,
  onDeleteProfile,
  onAttachProfile,
  onStartLocalProfile,
  onStopLocalProfile,
  onRefreshProfiles,
}: ServerSectionProps) {
  const {
    localProfile,
    remoteProfiles,
    draft,
    password,
    selected,
    setDraft,
    setPassword,
    setSelectedProfileId,
    createNewRemoteProfile,
    setIsCreatingNew,
  } = useRemoteProfileEditor(profiles)
  const { refreshDiagnostics, handleSave, handleDelete, handleAttach, handleRestartLocal } =
    useServerSectionActions({
      draft,
      password,
      remoteProfiles,
      localProfile,
      onSaveProfile,
      onDeleteProfile,
      onAttachProfile,
      onStopLocalProfile,
      onStartLocalProfile,
      onRefreshProfiles,
      setFeedback,
      setServerDiagnostics,
      onGetServerDiagnostics,
      onRepairRuntime,
      setIsCreatingNew,
      setSelectedProfileId,
    })

  const statusValue = serverDiagnostics?.runtime.status ?? runtime.status ?? 'unknown'
  const healthValue = serverDiagnostics?.health ?? 'unknown'
  const isRunning = String(statusValue) === 'running' || String(statusValue) === 'connected'
  const isHealthy = String(healthValue) === 'connected'

  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">server</p>
      <LocalRuntimeSection
        healthValue={healthValue}
        isHealthy={isHealthy}
        isRunning={isRunning}
        localProfile={localProfile}
        runtime={runtime}
        statusValue={statusValue}
        onRefreshDiagnostics={() => void refreshDiagnostics('Diagnostics refreshed', onGetServerDiagnostics)}
        onRepairRuntime={() => void refreshDiagnostics('Runtime repaired', onRepairRuntime)}
        onRestartLocal={() => void handleRestartLocal()}
      />
      <RemoteProfilesSection
        draft={draft}
        password={password}
        remoteProfiles={remoteProfiles}
        runtime={runtime}
        selected={selected}
        setDraft={setDraft}
        setIsCreatingNew={setIsCreatingNew}
        setPassword={setPassword}
        setSelectedProfileId={setSelectedProfileId}
        onAttach={() => void handleAttach()}
        onCreateNew={createNewRemoteProfile}
        onDelete={() => void handleDelete()}
        onSave={() => void handleSave()}
      />
    </section>
  )
}

function useRemoteProfileEditor(profiles: RuntimeProfile[]) {
  const localProfile = useMemo(() => profiles.find(profile => profile.startCommand), [profiles])
  const remoteProfiles = useMemo(
    () => profiles.filter(profile => !localProfile || profile.id !== localProfile.id),
    [localProfile, profiles]
  )
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(
    remoteProfiles[0]?.id
  )
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const selected = useMemo(
    () =>
      isCreatingNew
        ? undefined
        : (remoteProfiles.find(profile => profile.id === selectedProfileId) ?? remoteProfiles[0]),
    [isCreatingNew, remoteProfiles, selectedProfileId]
  )
  const [password, setPassword] = useState('')
  const [draft, setDraft] = useState<RuntimeProfileInput | null>(null)

  useEffect(() => {
    if (isCreatingNew) {
      return
    }
    if (!selected) {
      setDraft(null)
      return
    }
    setDraft({
      id: selected.id,
      name: selected.name,
      host: selected.host,
      port: selected.port,
      https: selected.https,
      username: selected.username,
      startCommand: false,
      startHost: selected.startHost,
      startPort: selected.startPort,
      cliPath: selected.cliPath,
      corsOrigins: selected.corsOrigins,
      password: '',
    })
    setPassword('')
  }, [isCreatingNew, selected])

  useEffect(() => {
    if (!selectedProfileId && remoteProfiles[0]?.id) {
      setSelectedProfileId(remoteProfiles[0].id)
    }
  }, [remoteProfiles, selectedProfileId])

  const createNewRemoteProfile = () => {
    setIsCreatingNew(true)
    setSelectedProfileId(undefined)
    setDraft({
      name: 'Remote OpenCode',
      host: '',
      port: 443,
      https: true,
      username: 'opencode',
      startCommand: false,
      startHost: '127.0.0.1',
      startPort: 4096,
      cliPath: '',
      corsOrigins: [],
      password: '',
    })
    setPassword('')
  }

  return {
    localProfile,
    remoteProfiles,
    draft,
    password,
    selected,
    setDraft,
    setPassword,
    setSelectedProfileId,
    createNewRemoteProfile,
    setIsCreatingNew,
  }
}

type ServerSectionActionsInput = {
  draft: RuntimeProfileInput | null
  password: string
  remoteProfiles: RuntimeProfile[]
  localProfile?: RuntimeProfile
  onSaveProfile: (profile: RuntimeProfileInput) => Promise<void>
  onDeleteProfile: (profileID: string) => Promise<void>
  onAttachProfile: (profileID: string) => Promise<void>
  onStopLocalProfile: () => Promise<void>
  onStartLocalProfile: (profileID: string) => Promise<void>
  onRefreshProfiles: () => Promise<void>
  setFeedback: (message: string) => void
  setServerDiagnostics: (diagnostics: ServerDiagnostics) => void
  onGetServerDiagnostics: () => Promise<ServerDiagnostics>
  onRepairRuntime: () => Promise<ServerDiagnostics>
  setIsCreatingNew: (value: boolean) => void
  setSelectedProfileId: (value: string | undefined) => void
}

function useServerSectionActions({
  draft,
  password,
  remoteProfiles,
  localProfile,
  onSaveProfile,
  onDeleteProfile,
  onAttachProfile,
  onStopLocalProfile,
  onStartLocalProfile,
  onRefreshProfiles,
  setFeedback,
  setServerDiagnostics,
  setIsCreatingNew,
  setSelectedProfileId,
}: ServerSectionActionsInput) {
  const refreshDiagnostics = async (message: string, action: () => Promise<ServerDiagnostics>) => {
    try {
      const next = await action()
      setServerDiagnostics(next)
      setFeedback(message)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  }

  const handleSave = async () => {
    if (!draft) {
      return
    }
    try {
      await onSaveProfile({ ...draft, password, corsOrigins: draft.corsOrigins })
      await onRefreshProfiles()
      setIsCreatingNew(false)
      setFeedback('Remote profile saved')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  }

  const handleDelete = async () => {
    if (!draft?.id) {
      return
    }
    try {
      await onDeleteProfile(draft.id)
      await onRefreshProfiles()
      setSelectedProfileId(remoteProfiles[0]?.id)
      setFeedback('Remote profile deleted')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  }

  const handleAttach = async () => {
    if (!draft?.id) {
      return
    }
    try {
      await onAttachProfile(draft.id)
      setFeedback('Attached to remote server')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  }

  const handleRestartLocal = async () => {
    if (!localProfile) {
      return
    }
    try {
      await onStopLocalProfile()
      await onStartLocalProfile(localProfile.id)
      setFeedback('Local runtime restarted')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  }

  return { refreshDiagnostics, handleSave, handleDelete, handleAttach, handleRestartLocal }
}
