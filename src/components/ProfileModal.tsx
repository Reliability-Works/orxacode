import { useEffect, useMemo, useState } from 'react'
import type { RuntimeProfile, RuntimeProfileInput, RuntimeState } from '@shared/ipc'

type Props = {
  open: boolean
  profiles: RuntimeProfile[]
  runtime: RuntimeState
  onClose: () => void
  onSave: (profile: RuntimeProfileInput) => Promise<void>
  onDelete: (profileID: string) => Promise<void>
  onAttach: (profileID: string) => Promise<void>
  onStartLocal: (profileID: string) => Promise<void>
  onStopLocal: () => Promise<void>
}

function buildProfileDraft(profile: RuntimeProfile): RuntimeProfileInput {
  return {
    id: profile.id,
    name: profile.name,
    host: profile.host,
    port: profile.port,
    https: profile.https,
    username: profile.username,
    startCommand: profile.startCommand,
    startHost: profile.startHost,
    startPort: profile.startPort,
    cliPath: profile.cliPath,
    corsOrigins: profile.corsOrigins,
    password: '',
  }
}

function createNewProfileDraft(): RuntimeProfileInput {
  return {
    name: 'New Profile',
    host: '127.0.0.1',
    port: 4096,
    https: false,
    username: 'opencode',
    startCommand: true,
    startHost: '127.0.0.1',
    startPort: 4096,
    cliPath: '',
    corsOrigins: [],
    password: '',
  }
}

type ProfileListProps = {
  profiles: RuntimeProfile[]
  selectedProfileId: string | undefined
  onSelectProfile: (profileId: string) => void
  onCreateProfile: () => void
}

function ProfileList({
  profiles,
  selectedProfileId,
  onSelectProfile,
  onCreateProfile,
}: ProfileListProps) {
  return (
    <aside className="profile-list">
      {profiles.map(profile => (
        <button
          type="button"
          key={profile.id}
          className={profile.id === selectedProfileId ? 'active' : ''}
          onClick={() => onSelectProfile(profile.id)}
        >
          <span>{profile.name}</span>
          <small>
            {profile.host}:{profile.port}
          </small>
        </button>
      ))}
      <button type="button" className="add-profile" onClick={onCreateProfile}>
        + New Profile
      </button>
    </aside>
  )
}

type ProfileFormProps = {
  draft: RuntimeProfileInput
  password: string
  runtime: RuntimeState
  onDraftChange: (nextDraft: RuntimeProfileInput) => void
  onPasswordChange: (nextPassword: string) => void
  onSave: () => void
  onDelete: () => void
  onAttach: () => void
  onStartLocal: () => void
  onStopLocal: () => void
}

type ProfileActionsProps = {
  draft: RuntimeProfileInput
  runtime: RuntimeState
  onSave: () => void
  onDelete: () => void
  onAttach: () => void
  onStartLocal: () => void
  onStopLocal: () => void
}

function ProfileActions({
  draft,
  runtime,
  onSave,
  onDelete,
  onAttach,
  onStartLocal,
  onStopLocal,
}: ProfileActionsProps) {
  return (
    <>
      <div className="profile-actions">
        <button type="button" onClick={onSave}>
          Save
        </button>
        {draft.id ? (
          <button type="button" className="danger" onClick={onDelete}>
            Delete
          </button>
        ) : null}
        {draft.id ? (
          <button type="button" onClick={onAttach}>
            Attach
          </button>
        ) : null}
        {draft.id ? (
          <button type="button" onClick={onStartLocal}>
            Start Local
          </button>
        ) : null}
        <button type="button" onClick={onStopLocal}>
          Stop Local
        </button>
      </div>

      <div className="runtime-status-inline">
        <strong>Status:</strong> {runtime.status}
        <span>{runtime.managedServer ? 'Managed by app' : 'External server'}</span>
        {runtime.lastError ? <span className="error">{runtime.lastError}</span> : null}
      </div>
    </>
  )
}

function ProfileForm({
  draft,
  password,
  runtime,
  onDraftChange,
  onPasswordChange,
  onSave,
  onDelete,
  onAttach,
  onStartLocal,
  onStopLocal,
}: ProfileFormProps) {
  return (
    <section className="profile-form">
      <label>
        Name
        <input value={draft.name} onChange={event => onDraftChange({ ...draft, name: event.target.value })} />
      </label>
      <div className="row-two">
        <label>
          Host
          <input value={draft.host} onChange={event => onDraftChange({ ...draft, host: event.target.value })} />
        </label>
        <label>
          Port
          <input
            type="number"
            value={draft.port}
            onChange={event => onDraftChange({ ...draft, port: Number(event.target.value) })}
          />
        </label>
      </div>
      <div className="row-two">
        <label>
          Username
          <input
            value={draft.username ?? ''}
            onChange={event => onDraftChange({ ...draft, username: event.target.value })}
          />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={event => onPasswordChange(event.target.value)} />
        </label>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.startCommand}
          onChange={event => onDraftChange({ ...draft, startCommand: event.target.checked })}
        />
        Start local OpenCode server from app
      </label>
      <div className="row-two">
        <label>
          Start Host
          <input
            value={draft.startHost}
            onChange={event => onDraftChange({ ...draft, startHost: event.target.value })}
          />
        </label>
        <label>
          Start Port
          <input
            type="number"
            value={draft.startPort}
            onChange={event => onDraftChange({ ...draft, startPort: Number(event.target.value) })}
          />
        </label>
      </div>
      <label>
        OpenCode binary path override (optional)
        <input
          value={draft.cliPath ?? ''}
          placeholder="opencode"
          onChange={event => onDraftChange({ ...draft, cliPath: event.target.value })}
        />
      </label>

      <ProfileActions
        draft={draft}
        runtime={runtime}
        onSave={onSave}
        onDelete={onDelete}
        onAttach={onAttach}
        onStartLocal={onStartLocal}
        onStopLocal={onStopLocal}
      />
    </section>
  )
}

export function ProfileModal({
  open,
  profiles,
  runtime,
  onClose,
  onSave,
  onDelete,
  onAttach,
  onStartLocal,
  onStopLocal,
}: Props) {
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(profiles[0]?.id)
  const selected = useMemo(
    () => profiles.find(item => item.id === selectedProfileId) ?? profiles[0],
    [profiles, selectedProfileId]
  )
  const [password, setPassword] = useState('')
  const [draft, setDraft] = useState<RuntimeProfileInput | null>(
    selected ? { ...selected, password: '' } : null
  )

  useEffect(() => {
    if (!selected) {
      setDraft(null)
      return
    }

    setDraft(buildProfileDraft(selected))
    setPassword('')
  }, [selected])

  if (!open || !draft) {
    return null
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Connection profiles">
      <div className="modal profile-modal">
        <header className="modal-header">
          <h2>profiles</h2>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            X
          </button>
        </header>

        <div className="profile-layout">
          <ProfileList
            profiles={profiles}
            selectedProfileId={selected?.id}
            onSelectProfile={setSelectedProfileId}
            onCreateProfile={() => {
              setSelectedProfileId(undefined)
              setDraft(createNewProfileDraft())
            }}
          />

          <ProfileForm
            draft={draft}
            password={password}
            runtime={runtime}
            onDraftChange={setDraft}
            onPasswordChange={setPassword}
            onSave={() =>
              void onSave({
                ...draft,
                password,
                corsOrigins: draft.corsOrigins,
              })
            }
            onDelete={() => void onDelete(draft.id!)}
            onAttach={() => void onAttach(draft.id!)}
            onStartLocal={() => void onStartLocal(draft.id!)}
            onStopLocal={() => void onStopLocal()}
          />
        </div>
      </div>
    </div>
  )
}
