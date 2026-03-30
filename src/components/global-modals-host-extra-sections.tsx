import type { Dispatch, SetStateAction } from 'react'
import { ProfileModal } from './ProfileModal'
import type {
  CommitFlowState,
  CommitSummary,
  GlobalModalsHostProps,
  SkillPromptTarget,
  SkillUseModalState,
} from './GlobalModalsHost'
import type { CommitNextStep } from '../hooks/useGitPanel'

function formatCommitStepLabel(step: CommitNextStep) {
  if (step === 'commit_and_push') {
    return 'Committing changes and pushing'
  }
  if (step === 'commit_and_create_pr') {
    return 'Creating Pull Request'
  }
  return 'Committing changes'
}

function CommitSummaryContent({
  commitSummaryLoading,
  commitSummary,
  commitIncludeUnstaged,
  setCommitIncludeUnstaged,
}: {
  commitSummaryLoading: boolean
  commitSummary: CommitSummary
  commitIncludeUnstaged: boolean
  setCommitIncludeUnstaged: Dispatch<SetStateAction<boolean>>
}) {
  if (commitSummaryLoading) {
    return <p className="permission-description">Loading changes...</p>
  }

  return (
    <>
      <div className="commit-summary-grid">
        <div>
          <small>Branch</small>
          <strong>{commitSummary?.branch ?? '...'}</strong>
        </div>
        <div>
          <small>Changes</small>
          <strong className="commit-summary-values">
            <span>{`${commitSummary?.filesChanged ?? 0} files`}</span>
            <span className="added">+{commitSummary?.insertions ?? 0}</span>
            <span className="removed">-{commitSummary?.deletions ?? 0}</span>
          </strong>
        </div>
      </div>

      <div>
        <p className="commit-section-header">Staged ({commitSummary?.filesChanged ?? 0})</p>
        <div className="commit-file-list">
          <div className="commit-file-row">
            <span className="commit-file-status commit-file-status--modified">M</span>
            <span className="commit-file-name">{commitSummary?.branch ?? '...'}</span>
          </div>
        </div>
      </div>

      <label className="commit-include-toggle">
        <input
          type="checkbox"
          checked={commitIncludeUnstaged}
          onChange={event => setCommitIncludeUnstaged(event.target.checked)}
        />
        Include unstaged changes
      </label>
    </>
  )
}

function CommitMessageField({
  commitMessageDraft,
  setCommitMessageDraft,
}: {
  commitMessageDraft: string
  setCommitMessageDraft: Dispatch<SetStateAction<string>>
}) {
  return (
    <div className="commit-message-field">
      <div className="commit-message-header">
        <span>commit message</span>
        <button type="button" className="commit-ai-btn">
          ai
        </button>
      </div>
      <textarea
        rows={4}
        value={commitMessageDraft}
        placeholder="Leave blank to autogenerate a commit message"
        onChange={event => setCommitMessageDraft(event.target.value)}
      />
    </div>
  )
}

function CommitNextStepSection({
  commitNextStepOptions,
  commitNextStep,
  setCommitNextStep,
}: {
  commitNextStepOptions: Array<{ id: CommitNextStep; label: string }>
  commitNextStep: CommitNextStep
  setCommitNextStep: Dispatch<SetStateAction<CommitNextStep>>
}) {
  return (
    <section className="commit-next-steps">
      <small>next step</small>
      {commitNextStepOptions.map(option => (
        <button
          key={option.id}
          type="button"
          className={commitNextStep === option.id ? 'active' : ''}
          onClick={() => setCommitNextStep(option.id)}
        >
          <span className="commit-radio-dot" aria-hidden="true" />
          <span>{option.label}</span>
        </button>
      ))}
    </section>
  )
}

export function CommitModal({
  commitModalOpen,
  activeProjectDir,
  setCommitModalOpen,
  commitSummary,
  commitSummaryLoading,
  commitIncludeUnstaged,
  setCommitIncludeUnstaged,
  commitMessageDraft,
  setCommitMessageDraft,
  commitNextStepOptions,
  commitNextStep,
  setCommitNextStep,
  commitSubmitting,
  commitBaseBranch,
  setCommitBaseBranch,
  commitBaseBranchOptions,
  commitBaseBranchLoading,
  submitCommit,
}: Pick<
  GlobalModalsHostProps,
  | 'commitModalOpen'
  | 'activeProjectDir'
  | 'setCommitModalOpen'
  | 'commitSummary'
  | 'commitSummaryLoading'
  | 'commitIncludeUnstaged'
  | 'setCommitIncludeUnstaged'
  | 'commitMessageDraft'
  | 'setCommitMessageDraft'
  | 'commitNextStepOptions'
  | 'commitNextStep'
  | 'setCommitNextStep'
  | 'commitSubmitting'
  | 'commitBaseBranch'
  | 'setCommitBaseBranch'
  | 'commitBaseBranchOptions'
  | 'commitBaseBranchLoading'
  | 'submitCommit'
>) {
  if (!commitModalOpen || !activeProjectDir) {
    return null
  }

  return (
    <div className="overlay" onClick={() => setCommitModalOpen(false)}>
      <section className="modal commit-modal" onClick={event => event.stopPropagation()}>
        <header className="modal-header">
          <h2>commit changes</h2>
          <button type="button" className="modal-close-btn" onClick={() => setCommitModalOpen(false)}>
            X
          </button>
        </header>
        <div className="commit-modal-body">
          <CommitSummaryContent
            commitSummaryLoading={commitSummaryLoading}
            commitSummary={commitSummary}
            commitIncludeUnstaged={commitIncludeUnstaged}
            setCommitIncludeUnstaged={setCommitIncludeUnstaged}
          />
          <CommitMessageField commitMessageDraft={commitMessageDraft} setCommitMessageDraft={setCommitMessageDraft} />
          <CommitNextStepSection
            commitNextStepOptions={commitNextStepOptions}
            commitNextStep={commitNextStep}
            setCommitNextStep={setCommitNextStep}
          />
          {commitNextStep === 'commit_and_create_pr' ? (
            <label className="commit-base-branch-field">
              Base branch for PR
              <select
                value={commitBaseBranch}
                onChange={event => setCommitBaseBranch(event.target.value)}
                disabled={commitBaseBranchLoading}
              >
                <option value="">Use repository default</option>
                {commitBaseBranchOptions.map(branch => (
                  <option key={`commit-base-${branch}`} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="modal-action-bar">
          <button type="button" onClick={() => setCommitModalOpen(false)}>cancel</button>
          <button
            type="button"
            className="primary"
            disabled={commitSubmitting || commitSummaryLoading}
            onClick={() => void submitCommit()}
          >
            {commitSubmitting ? 'committing...' : 'commit'}
          </button>
        </div>
      </section>
    </div>
  )
}

export function CommitFlowModal({
  commitFlowState,
  dismissCommitFlowState,
}: {
  commitFlowState: CommitFlowState
  dismissCommitFlowState: () => void
}) {
  if (!commitFlowState) {
    return null
  }

  return (
    <div
      className="overlay"
      onClick={commitFlowState.phase === 'running' ? undefined : dismissCommitFlowState}
    >
      <section className="modal commit-progress-modal" onClick={event => event.stopPropagation()}>
        <div className="commit-progress-body">
          {commitFlowState.phase === 'running' ? (
            <>
              <span className="session-status-indicator busy commit-progress-spinner" aria-hidden="true" />
              <h2>{formatCommitStepLabel(commitFlowState.nextStep)}</h2>
            </>
          ) : commitFlowState.phase === 'success' ? (
            <>
              <h2>{commitFlowState.message}</h2>
              <p>Complete</p>
            </>
          ) : (
            <>
              <h2>Commit flow failed</h2>
              <p>{commitFlowState.message}</p>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

function SkillTargetSelector({
  skillPreparing,
  setSkillTargetSelectorOpen,
  submitSkillPrompt,
}: {
  skillPreparing: boolean
  setSkillTargetSelectorOpen: Dispatch<SetStateAction<boolean>>
  submitSkillPrompt: (sessionTarget: SkillPromptTarget) => Promise<void>
}) {
  return (
    <section className="skill-use-target-selector">
      <p>Add this prepared prompt to:</p>
      <div className="skill-use-target-actions">
        <button type="button" disabled={skillPreparing} onClick={() => void submitSkillPrompt('current')}>
          Current session
        </button>
        <button
          type="button"
          className="primary"
          disabled={skillPreparing}
          onClick={() => void submitSkillPrompt('new')}
        >
          New session
        </button>
        <button type="button" disabled={skillPreparing} onClick={() => setSkillTargetSelectorOpen(false)}>
          Cancel
        </button>
      </div>
    </section>
  )
}

function SkillProjectSelector({
  skillUseModal,
  setSkillUseModal,
  projects,
  addProjectDirectory,
}: {
  skillUseModal: NonNullable<SkillUseModalState>
  setSkillUseModal: Dispatch<SetStateAction<SkillUseModalState>>
  projects: GlobalModalsHostProps['projects']
  addProjectDirectory: GlobalModalsHostProps['addProjectDirectory']
}) {
  return (
    <label>
      target workspace
      <div className="skill-use-project-row">
        <select
          value={skillUseModal.projectDir}
          onChange={event =>
            setSkillUseModal(current =>
              current ? { ...current, projectDir: event.target.value } : current
            )
          }
        >
          <option value="">choose a workspace</option>
          {projects.map(project => (
            <option key={`skill-use-${project.id}`} value={project.worktree}>
              {project.name || project.worktree.split('/').at(-1) || project.worktree}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() =>
            void addProjectDirectory({ select: false }).then(directory => {
              if (!directory) {
                return
              }
              setSkillUseModal(current => (current ? { ...current, projectDir: directory } : current))
            })
          }
        >
          Add new workspace
        </button>
      </div>
    </label>
  )
}

export function SkillUseModalSection({
  skillUseModal,
  setSkillUseModal,
  projects,
  addProjectDirectory,
  skillTargetSelectorOpen,
  setSkillTargetSelectorOpen,
  skillPreparing,
  submitSkillPrompt,
}: {
  skillUseModal: SkillUseModalState
  setSkillUseModal: Dispatch<SetStateAction<SkillUseModalState>>
  projects: GlobalModalsHostProps['projects']
  addProjectDirectory: GlobalModalsHostProps['addProjectDirectory']
  skillTargetSelectorOpen: boolean
  setSkillTargetSelectorOpen: Dispatch<SetStateAction<boolean>>
  skillPreparing: boolean
  submitSkillPrompt: (sessionTarget: SkillPromptTarget) => Promise<void>
}) {
  if (!skillUseModal) {
    return null
  }

  return (
    <div className="overlay" onClick={() => setSkillUseModal(null)}>
      <section className="modal skill-use-modal" onClick={event => event.stopPropagation()}>
        <header className="modal-header">
          <h2>use skill: {skillUseModal.skill.name}</h2>
          <button type="button" className="modal-close-btn" onClick={() => setSkillUseModal(null)}>
            X
          </button>
        </header>
        <div className="skill-use-body">
          <SkillProjectSelector
            skillUseModal={skillUseModal}
            setSkillUseModal={setSkillUseModal}
            projects={projects}
            addProjectDirectory={addProjectDirectory}
          />
          <p className="skill-use-description">{skillUseModal.skill.description}</p>
          {skillTargetSelectorOpen ? (
            <SkillTargetSelector
              skillPreparing={skillPreparing}
              setSkillTargetSelectorOpen={setSkillTargetSelectorOpen}
              submitSkillPrompt={submitSkillPrompt}
            />
          ) : null}
        </div>
        <div className="modal-action-bar">
          <button type="button" disabled={skillPreparing} onClick={() => setSkillUseModal(null)}>
            cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!skillUseModal.projectDir || skillPreparing}
            onClick={() => setSkillTargetSelectorOpen(true)}
          >
            {skillPreparing ? 'Preparing...' : 'Prepare prompt'}
          </button>
        </div>
      </section>
    </div>
  )
}

export function ProfileModalSection({
  profileModalOpen,
  setProfileModalOpen,
  profiles,
  runtime,
  onSaveProfile,
  onDeleteProfile,
  onAttachProfile,
  onStartLocalProfile,
  onStopLocalProfile,
}: Pick<
  GlobalModalsHostProps,
  | 'profileModalOpen'
  | 'setProfileModalOpen'
  | 'profiles'
  | 'runtime'
  | 'onSaveProfile'
  | 'onDeleteProfile'
  | 'onAttachProfile'
  | 'onStartLocalProfile'
  | 'onStopLocalProfile'
>) {
  return (
    <ProfileModal
      open={profileModalOpen}
      profiles={profiles}
      runtime={runtime}
      onClose={() => setProfileModalOpen(false)}
      onSave={onSaveProfile}
      onDelete={onDeleteProfile}
      onAttach={onAttachProfile}
      onStartLocal={onStartLocalProfile}
      onStopLocal={onStopLocalProfile}
    />
  )
}
