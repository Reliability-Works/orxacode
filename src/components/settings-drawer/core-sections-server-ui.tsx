import { ChevronDown, ChevronRight, Plus, Plug, Trash2 } from 'lucide-react'
import type { RuntimeProfile, RuntimeProfileInput, RuntimeState } from '@shared/ipc'

function formatEndpoint(baseUrl?: string) {
  if (!baseUrl) {
    return 'Not connected'
  }
  try {
    const url = new URL(baseUrl)
    return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`
  } catch {
    return baseUrl
  }
}

type LocalRuntimeSectionProps = {
  healthValue: string
  isHealthy: boolean
  isRunning: boolean
  localProfile?: RuntimeProfile
  runtime: RuntimeState
  statusValue: string
  onRefreshDiagnostics: () => void
  onRepairRuntime: () => void
  onRestartLocal: () => void
}

export function LocalRuntimeSection({
  healthValue,
  isHealthy,
  isRunning,
  localProfile,
  runtime,
  statusValue,
  onRefreshDiagnostics,
  onRepairRuntime,
  onRestartLocal,
}: LocalRuntimeSectionProps) {
  return (
    <>
      <p className="settings-server-subtitle">// local runtime</p>
      <div className="settings-server-status-card">
        <div className="settings-server-status-row">
          <span className="settings-server-status-key">status</span>
          <span
            className={`settings-server-status-value${isRunning ? ' settings-server-status-value--green' : ''}`}
          >
            {statusValue}
          </span>
        </div>
        <div className="settings-server-status-row">
          <span className="settings-server-status-key">health</span>
          <span
            className={`settings-server-status-value${isHealthy ? ' settings-server-status-value--green' : ''}`}
          >
            {healthValue}
          </span>
        </div>
        <div className="settings-server-status-row">
          <span className="settings-server-status-key">connection</span>
          <span
            className={`settings-server-status-value${runtime.status === 'connected' ? ' settings-server-status-value--green' : ''}`}
          >
            {runtime.managedServer ? formatEndpoint(runtime.baseUrl) : 'Not managed by app'}
          </span>
        </div>
        <div className="settings-server-status-row">
          <span className="settings-server-status-key">launch config</span>
          <span className="settings-server-status-value">
            {localProfile ? `${localProfile.startHost}:${localProfile.startPort}` : 'Unavailable'}
          </span>
        </div>
        <div className="settings-server-status-row">
          <span className="settings-server-status-key">server type</span>
          <span className="settings-server-status-value">
            {runtime.managedServer ? 'managed by app' : 'external'}
          </span>
        </div>
        {runtime.lastError ? (
          <div className="settings-server-status-row">
            <span className="settings-server-status-key">error</span>
            <span className="settings-server-status-value settings-server-status-value--error">
              {runtime.lastError}
            </span>
          </div>
        ) : null}
      </div>
      <p className="settings-server-help">
        Local OpenCode is managed by Orxa. The live endpoint can change on each launch, so this
        section shows the actual connected runtime rather than an editable profile.
      </p>
      <div className="settings-server-buttons">
        <button type="button" className="settings-server-btn" onClick={onRefreshDiagnostics}>
          <ChevronDown size={12} />
          refresh diagnostics
        </button>
        <button type="button" className="settings-server-btn" onClick={onRepairRuntime}>
          <ChevronRight size={12} />
          repair runtime
        </button>
        {localProfile ? (
          <button type="button" className="settings-server-btn" onClick={onRestartLocal}>
            restart local runtime
          </button>
        ) : null}
      </div>
    </>
  )
}

type RemoteProfilesSectionProps = {
  draft: RuntimeProfileInput | null
  password: string
  remoteProfiles: RuntimeProfile[]
  runtime: RuntimeState
  selected?: RuntimeProfile
  setDraft: (value: RuntimeProfileInput | null) => void
  setIsCreatingNew: (value: boolean) => void
  setPassword: (value: string) => void
  setSelectedProfileId: (value: string | undefined) => void
  onAttach: () => void
  onCreateNew: () => void
  onDelete: () => void
  onSave: () => void
}

export function RemoteProfilesSection({
  draft,
  password,
  remoteProfiles,
  runtime,
  selected,
  setDraft,
  setIsCreatingNew,
  setPassword,
  setSelectedProfileId,
  onAttach,
  onCreateNew,
  onDelete,
  onSave,
}: RemoteProfilesSectionProps) {
  return (
    <>
      <p className="settings-server-subtitle" style={{ marginTop: 16 }}>
        // remote profiles
      </p>
      <p className="settings-server-help">
        Remote profiles are for attaching to an OpenCode server hosted elsewhere. They do not
        control the app-managed local runtime.
      </p>
      <div className="settings-profiles-layout">
        <div className="settings-profiles-list">
          {remoteProfiles.map(profile => (
            <button
              key={profile.id}
              type="button"
              className={`settings-profile-item${profile.id === selected?.id ? ' active' : ''}`}
              onClick={() => {
                setIsCreatingNew(false)
                setSelectedProfileId(profile.id)
              }}
            >
              <span className="settings-profile-item-name">{profile.name}</span>
              <span className="settings-profile-item-addr">
                {profile.https ? 'https' : 'http'}://{profile.host}:{profile.port}
              </span>
              {runtime.activeProfileId === profile.id && !runtime.managedServer ? (
                <span className="settings-profile-item-connected" />
              ) : null}
            </button>
          ))}
          <button type="button" className="settings-profile-add" onClick={onCreateNew}>
            <Plus size={12} /> new remote profile
          </button>
        </div>
        {draft ? (
          <RemoteProfileForm
            draft={draft}
            password={password}
            setDraft={setDraft}
            setPassword={setPassword}
            onAttach={onAttach}
            onDelete={onDelete}
            onSave={onSave}
          />
        ) : (
          <div className="settings-server-empty-state">
            No remote profiles yet. Add one to attach Orxa to an externally hosted OpenCode server.
          </div>
        )}
      </div>
    </>
  )
}

type RemoteProfileFormProps = {
  draft: RuntimeProfileInput
  password: string
  setDraft: (value: RuntimeProfileInput | null) => void
  setPassword: (value: string) => void
  onAttach: () => void
  onDelete: () => void
  onSave: () => void
}

function RemoteProfileForm({
  draft,
  password,
  setDraft,
  setPassword,
  onAttach,
  onDelete,
  onSave,
}: RemoteProfileFormProps) {
  return (
    <div className="settings-profile-form">
      <label>
        name
        <input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <div className="settings-profile-row-2">
        <label>
          host
          <input value={draft.host} onChange={event => setDraft({ ...draft, host: event.target.value })} />
        </label>
        <label>
          port
          <input
            type="number"
            value={draft.port}
            onChange={event => setDraft({ ...draft, port: Number(event.target.value) })}
          />
        </label>
      </div>
      <div className="settings-profile-row-2">
        <label>
          username
          <input
            value={draft.username ?? ''}
            onChange={event => setDraft({ ...draft, username: event.target.value })}
          />
        </label>
        <label>
          password
          <input type="password" value={password} onChange={event => setPassword(event.target.value)} />
        </label>
      </div>
      <label className="settings-inline-toggle">
        use https
        <input
          type="checkbox"
          checked={draft.https}
          onChange={event => setDraft({ ...draft, https: event.target.checked })}
        />
      </label>
      <div className="settings-profile-actions">
        <button type="button" className="settings-server-btn" onClick={onSave}>
          save
        </button>
        {draft.id ? (
          <button
            type="button"
            className="settings-server-btn settings-profile-btn-green"
            onClick={onAttach}
          >
            <Plug size={11} /> attach
          </button>
        ) : null}
        {draft.id ? (
          <button
            type="button"
            className="settings-server-btn settings-profile-btn-danger"
            onClick={onDelete}
          >
            <Trash2 size={11} /> delete
          </button>
        ) : null}
      </div>
    </div>
  )
}
