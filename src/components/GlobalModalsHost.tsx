import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type {
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
} from '@opencode-ai/sdk/v2/client'
import type {
  ClaudeBrowserSessionSummary,
  ProjectListItem,
  RuntimeDependencyReport,
  RuntimeProfile,
  RuntimeProfileInput,
  RuntimeState,
  SkillEntry,
  WorkspaceWorktree,
  CodexWorkspaceThreadEntry,
} from '@shared/ipc'
import type { CommitNextStep } from '../hooks/useGitPanel'
import type { WorkspaceDetailSessionEntry } from '../hooks/useAppShellSessionCollections'
import type { PermissionMode } from '../types/app'
import type { SessionType } from '../types/canvas'
import {
  DependencyModal,
  WorkspaceDetailModal,
} from './global-modals-host-sections'
import { BranchCreateModal } from './BranchCreateModal'
import { ClaudeSessionBrowserModal } from './ClaudeSessionBrowserModal'
import {
  CommitFlowModal,
  CommitModal,
  ProfileModalSection,
  SkillUseModalSection,
} from './global-modals-host-extra-sections'

export type SkillUseModalState = { skill: SkillEntry; projectDir: string } | null
export type SkillPromptTarget = 'current' | 'new'

export type CommitSummary = {
  branch: string
  filesChanged: number
  insertions: number
  deletions: number
  repoRoot: string
} | null

export type CommitFlowState = {
  phase: 'running' | 'success' | 'error'
  nextStep: CommitNextStep
  message: string
} | null

export type GlobalModalsHostProps = {
  activeProjectDir?: string
  workspaceDetailDirectory?: string
  permissionMode: PermissionMode
  dependencyReport: RuntimeDependencyReport | null
  dependencyModalOpen: boolean
  setDependencyModalOpen: Dispatch<SetStateAction<boolean>>
  onCheckDependencies: () => void | Promise<void>
  permissionRequest: PermissionRequest | null
  permissionDecisionInFlight: boolean
  replyPermission: (decision: 'once' | 'always' | 'reject') => void | Promise<void>
  questionRequest: QuestionRequest | null
  replyQuestion: (answers: QuestionAnswer[]) => void | Promise<void>
  rejectQuestion: () => void | Promise<void>
  allSessionsModalOpen: boolean
  setAllSessionsModalOpen: Dispatch<SetStateAction<boolean>>
  claudeSessionBrowserOpen: boolean
  setClaudeSessionBrowserOpen: Dispatch<SetStateAction<boolean>>
  claudeBrowserSessions: ClaudeBrowserSessionSummary[]
  claudeBrowserSessionsLoading: boolean
  selectedClaudeBrowserWorkspace: string
  setSelectedClaudeBrowserWorkspace: (directory: string) => void
  openClaudeBrowserSession: (session: ClaudeBrowserSessionSummary) => Promise<void>
  sessions: WorkspaceDetailSessionEntry[]
  workspaceWorktrees: WorkspaceWorktree[]
  workspaceWorktreesLoading: boolean
  workspaceCodexThreads: CodexWorkspaceThreadEntry[]
  selectedWorktreeDirectory: string
  setSelectedWorktreeDirectory: (directory: string) => void
  createWorkspaceWorktree: (name: string) => Promise<void>
  openWorkspaceWorktree: (directory: string) => Promise<void>
  deleteWorkspaceWorktree: (directory: string) => Promise<void>
  launchSessionInWorktree: (directory: string, sessionType: SessionType) => Promise<void>
  openWorkspaceCodexThread: (directory: string, threadId: string, title?: string) => Promise<void>
  getSessionStatusType: (sessionID: string, directory?: string) => string
  activeSessionID?: string
  openSession: (directory: string, sessionID: string) => void | Promise<void>
  projects: ProjectListItem[]
  branchCreateModalOpen: boolean
  setBranchCreateModalOpen: Dispatch<SetStateAction<boolean>>
  branchCreateName: string
  setBranchCreateName: Dispatch<SetStateAction<string>>
  branchCreateError: string | null
  setBranchCreateError: Dispatch<SetStateAction<string | null>>
  submitBranchCreate: () => Promise<void>
  branchSwitching: boolean
  commitModalOpen: boolean
  setCommitModalOpen: Dispatch<SetStateAction<boolean>>
  commitSummary: CommitSummary
  commitSummaryLoading: boolean
  commitIncludeUnstaged: boolean
  setCommitIncludeUnstaged: Dispatch<SetStateAction<boolean>>
  commitMessageDraft: string
  setCommitMessageDraft: Dispatch<SetStateAction<string>>
  commitNextStepOptions: Array<{ id: CommitNextStep; label: string; icon: ReactNode }>
  commitNextStep: CommitNextStep
  setCommitNextStep: Dispatch<SetStateAction<CommitNextStep>>
  commitSubmitting: boolean
  commitBaseBranch: string
  setCommitBaseBranch: Dispatch<SetStateAction<string>>
  commitBaseBranchOptions: string[]
  commitBaseBranchLoading: boolean
  commitFlowState: CommitFlowState
  dismissCommitFlowState: () => void
  submitCommit: () => Promise<void>
  addProjectDirectory: (options?: { select?: boolean }) => Promise<string | undefined>
  skillUseModal: SkillUseModalState
  setSkillUseModal: Dispatch<SetStateAction<SkillUseModalState>>
  applySkillToProject: (
    skill: SkillEntry,
    targetProjectDir: string,
    sessionTarget: SkillPromptTarget
  ) => Promise<void>
  profileModalOpen: boolean
  setProfileModalOpen: Dispatch<SetStateAction<boolean>>
  profiles: RuntimeProfile[]
  runtime: RuntimeState
  onSaveProfile: (profile: RuntimeProfileInput) => Promise<void>
  onDeleteProfile: (profileID: string) => Promise<void>
  onAttachProfile: (profileID: string) => Promise<void>
  onStartLocalProfile: (profileID: string) => Promise<void>
  onStopLocalProfile: () => Promise<void>
}

function GlobalModalsContent({
  props,
  dependencyReport,
  copiedDependencyKey,
  copyDependencyCommand,
  dependencyRequiredMissing,
  closeDependencyModal,
  skillUseModal,
  skillTargetSelectorOpen,
  setSkillTargetSelectorOpen,
  skillPreparing,
  submitSkillPrompt,
}: {
  props: Omit<GlobalModalsHostProps, 'dependencyReport' | 'setDependencyModalOpen' | 'applySkillToProject' | 'skillUseModal'>
  dependencyReport: RuntimeDependencyReport | null
  copiedDependencyKey: string | null
  copyDependencyCommand: (installCommand: string, key: string) => Promise<void>
  dependencyRequiredMissing: boolean
  closeDependencyModal: () => void
  skillUseModal: SkillUseModalState
  skillTargetSelectorOpen: boolean
  setSkillTargetSelectorOpen: Dispatch<SetStateAction<boolean>>
  skillPreparing: boolean
  submitSkillPrompt: (sessionTarget: SkillPromptTarget) => Promise<void>
}) {
  return (
    <>
      <WorkspaceAndCommitModals
        props={props}
        dependencyReport={dependencyReport}
        copiedDependencyKey={copiedDependencyKey}
        copyDependencyCommand={copyDependencyCommand}
        dependencyRequiredMissing={dependencyRequiredMissing}
        closeDependencyModal={closeDependencyModal}
      />
      <SkillAndProfileModals
        props={props}
        skillUseModal={skillUseModal}
        skillTargetSelectorOpen={skillTargetSelectorOpen}
        setSkillTargetSelectorOpen={setSkillTargetSelectorOpen}
        skillPreparing={skillPreparing}
        submitSkillPrompt={submitSkillPrompt}
      />
    </>
  )
}

function WorkspaceAndCommitModals({
  props,
  dependencyReport,
  copiedDependencyKey,
  copyDependencyCommand,
  dependencyRequiredMissing,
  closeDependencyModal,
}: {
  props: Omit<GlobalModalsHostProps, 'dependencyReport' | 'setDependencyModalOpen' | 'applySkillToProject' | 'skillUseModal'>
  dependencyReport: RuntimeDependencyReport | null
  copiedDependencyKey: string | null
  copyDependencyCommand: (installCommand: string, key: string) => Promise<void>
  dependencyRequiredMissing: boolean
  closeDependencyModal: () => void
}) {
  return (
    <>
      <DependencyModal
        dependencyModalOpen={props.dependencyModalOpen}
        dependencyReport={dependencyReport}
        copiedDependencyKey={copiedDependencyKey}
        copyDependencyCommand={copyDependencyCommand}
        dependencyRequiredMissing={dependencyRequiredMissing}
        closeDependencyModal={closeDependencyModal}
        onCheckDependencies={props.onCheckDependencies}
      />
      <WorkspaceDetailModal
        allSessionsModalOpen={props.allSessionsModalOpen}
        setAllSessionsModalOpen={props.setAllSessionsModalOpen}
        workspaceDetailDirectory={props.workspaceDetailDirectory}
        sessions={props.sessions}
        workspaceWorktrees={props.workspaceWorktrees}
        workspaceWorktreesLoading={props.workspaceWorktreesLoading}
        workspaceCodexThreads={props.workspaceCodexThreads}
        selectedWorktreeDirectory={props.selectedWorktreeDirectory}
        setSelectedWorktreeDirectory={props.setSelectedWorktreeDirectory}
        createWorkspaceWorktree={props.createWorkspaceWorktree}
        openWorkspaceWorktree={props.openWorkspaceWorktree}
        deleteWorkspaceWorktree={props.deleteWorkspaceWorktree}
        launchSessionInWorktree={props.launchSessionInWorktree}
        openWorkspaceCodexThread={props.openWorkspaceCodexThread}
        getSessionStatusType={props.getSessionStatusType}
        activeSessionID={props.activeSessionID}
        openSession={props.openSession}
      />
      <ClaudeSessionBrowserModal
        isOpen={props.claudeSessionBrowserOpen}
        setIsOpen={props.setClaudeSessionBrowserOpen}
        sessions={props.claudeBrowserSessions}
        loading={props.claudeBrowserSessionsLoading}
        projects={props.projects}
        selectedWorkspaceDirectory={props.selectedClaudeBrowserWorkspace}
        setSelectedWorkspaceDirectory={props.setSelectedClaudeBrowserWorkspace}
        onOpenSession={props.openClaudeBrowserSession}
      />
      <BranchCreateModal
        branchCreateModalOpen={props.branchCreateModalOpen}
        setBranchCreateModalOpen={props.setBranchCreateModalOpen}
        branchCreateName={props.branchCreateName}
        setBranchCreateName={props.setBranchCreateName}
        branchCreateError={props.branchCreateError}
        setBranchCreateError={props.setBranchCreateError}
        submitBranchCreate={props.submitBranchCreate}
        branchSwitching={props.branchSwitching}
      />
      <CommitModal
        commitModalOpen={props.commitModalOpen}
        activeProjectDir={props.activeProjectDir}
        setCommitModalOpen={props.setCommitModalOpen}
        commitSummary={props.commitSummary}
        commitSummaryLoading={props.commitSummaryLoading}
        commitIncludeUnstaged={props.commitIncludeUnstaged}
        setCommitIncludeUnstaged={props.setCommitIncludeUnstaged}
        commitMessageDraft={props.commitMessageDraft}
        setCommitMessageDraft={props.setCommitMessageDraft}
        commitNextStepOptions={props.commitNextStepOptions}
        commitNextStep={props.commitNextStep}
        setCommitNextStep={props.setCommitNextStep}
        commitSubmitting={props.commitSubmitting}
        commitBaseBranch={props.commitBaseBranch}
        setCommitBaseBranch={props.setCommitBaseBranch}
        commitBaseBranchOptions={props.commitBaseBranchOptions}
        commitBaseBranchLoading={props.commitBaseBranchLoading}
        submitCommit={props.submitCommit}
      />
      <CommitFlowModal
        commitFlowState={props.commitFlowState}
        dismissCommitFlowState={props.dismissCommitFlowState}
      />
    </>
  )
}

function SkillAndProfileModals({
  props,
  skillUseModal,
  skillTargetSelectorOpen,
  setSkillTargetSelectorOpen,
  skillPreparing,
  submitSkillPrompt,
}: {
  props: Omit<GlobalModalsHostProps, 'dependencyReport' | 'setDependencyModalOpen' | 'applySkillToProject' | 'skillUseModal'>
  skillUseModal: SkillUseModalState
  skillTargetSelectorOpen: boolean
  setSkillTargetSelectorOpen: Dispatch<SetStateAction<boolean>>
  skillPreparing: boolean
  submitSkillPrompt: (sessionTarget: SkillPromptTarget) => Promise<void>
}) {
  return (
    <>
      <SkillUseModalSection
        skillUseModal={skillUseModal}
        setSkillUseModal={props.setSkillUseModal}
        projects={props.projects}
        addProjectDirectory={props.addProjectDirectory}
        skillTargetSelectorOpen={skillTargetSelectorOpen}
        setSkillTargetSelectorOpen={setSkillTargetSelectorOpen}
        skillPreparing={skillPreparing}
        submitSkillPrompt={submitSkillPrompt}
      />
      <ProfileModalSection
        profileModalOpen={props.profileModalOpen}
        setProfileModalOpen={props.setProfileModalOpen}
        profiles={props.profiles}
        runtime={props.runtime}
        onSaveProfile={props.onSaveProfile}
        onDeleteProfile={props.onDeleteProfile}
        onAttachProfile={props.onAttachProfile}
        onStartLocalProfile={props.onStartLocalProfile}
        onStopLocalProfile={props.onStopLocalProfile}
      />
    </>
  )
}

export function GlobalModalsHost({
  dependencyReport,
  setDependencyModalOpen,
  applySkillToProject,
  skillUseModal,
  ...props
}: GlobalModalsHostProps) {
  const [copiedDependencyKey, setCopiedDependencyKey] = useState<string | null>(null)
  const [skillTargetSelectorOpen, setSkillTargetSelectorOpen] = useState(false)
  const [skillPreparing, setSkillPreparing] = useState(false)

  useEffect(() => {
    if (!copiedDependencyKey) {
      return
    }
    const timer = window.setTimeout(() => setCopiedDependencyKey(null), 1200)
    return () => window.clearTimeout(timer)
  }, [copiedDependencyKey])

  useEffect(() => {
    setSkillTargetSelectorOpen(false)
    setSkillPreparing(false)
  }, [skillUseModal?.skill.id, skillUseModal?.projectDir])

  const copyDependencyCommand = async (installCommand: string, key: string) => {
    try {
      await navigator.clipboard.writeText(installCommand)
      setCopiedDependencyKey(key)
    } catch {
      setCopiedDependencyKey(null)
    }
  }

  const dependencyRequiredMissing = Boolean(dependencyReport?.missingRequired)
  const closeDependencyModal = () => {
    if (!dependencyRequiredMissing) {
      setDependencyModalOpen(false)
    }
  }

  const submitSkillPrompt = async (sessionTarget: SkillPromptTarget) => {
    if (!skillUseModal?.projectDir) {
      return
    }
    try {
      setSkillPreparing(true)
      await applySkillToProject(skillUseModal.skill, skillUseModal.projectDir, sessionTarget)
    } finally {
      setSkillPreparing(false)
      setSkillTargetSelectorOpen(false)
    }
  }

  return (
    <GlobalModalsContent
      props={props}
      dependencyReport={dependencyReport}
      copiedDependencyKey={copiedDependencyKey}
      copyDependencyCommand={copyDependencyCommand}
      dependencyRequiredMissing={dependencyRequiredMissing}
      closeDependencyModal={closeDependencyModal}
      skillUseModal={skillUseModal}
      skillTargetSelectorOpen={skillTargetSelectorOpen}
      setSkillTargetSelectorOpen={setSkillTargetSelectorOpen}
      skillPreparing={skillPreparing}
      submitSkillPrompt={submitSkillPrompt}
    />
  )
}
