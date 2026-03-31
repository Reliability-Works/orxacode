import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type {
  ProjectListItem,
  ProjectBootstrap,
  SessionMessageBundle,
  SkillEntry,
} from '@shared/ipc'
import type { SkillPromptTarget, SkillUseModalState } from './components/GlobalModalsHost'
import type {
  AppShellConfirmDialogRequest,
  AppShellTextInputDialogState,
} from './hooks/useAppShellDialogs'
import type { SetMessages, SetProjectData } from './hooks/useWorkspaceState-store'
import type { SidebarMode } from './hooks/useWorkspaceState-shared'
import { opencodeClient } from './lib/services/opencodeClient'

type TerminalTab = { id: string; label: string }

type SharedProjectActionsArgs = {
  activeProjectDir: string | undefined
  activeSessionID: string | undefined
  projects: ProjectListItem[]
  bootstrap: () => Promise<void>
  selectProject: (directory: string) => Promise<unknown>
  setStatusLine: (message: string) => void
  pushToast: (message: string, tone: 'info' | 'warning' | 'error', durationMs?: number) => void
}

type SkillActionsArgs = SharedProjectActionsArgs & {
  setSkills: Dispatch<SetStateAction<SkillEntry[]>>
  setSkillsLoading: Dispatch<SetStateAction<boolean>>
  setSkillsError: Dispatch<SetStateAction<string | undefined>>
  setSkillUseModal: Dispatch<SetStateAction<SkillUseModalState>>
  setProjectData: SetProjectData
  setActiveSessionID: (value: string | undefined) => void
  setComposer: Dispatch<SetStateAction<string>>
  setMessages: SetMessages
  setOpencodeMessages: (
    directory: string,
    sessionID: string,
    messages: SessionMessageBundle[]
  ) => void
  setSidebarMode: Dispatch<SetStateAction<SidebarMode>>
}

type DirectoryActionsArgs = SharedProjectActionsArgs & {
  requestConfirmation: (request: AppShellConfirmDialogRequest) => Promise<boolean>
  setActiveProjectDir: (value: string | undefined) => void
  setActiveSessionID: (value: string | undefined) => void
  setProjectData: SetProjectData
  setMessages: SetMessages
  setTerminalTabs: Dispatch<SetStateAction<TerminalTab[]>>
  setActiveTerminalId: Dispatch<SetStateAction<string | undefined>>
  setTerminalOpen: Dispatch<SetStateAction<boolean>>
}

type WorktreeActionsArgs = {
  bootstrap: () => Promise<void>
  selectProject: (directory: string) => Promise<unknown>
  setActiveSessionID: (value: string | undefined) => void
  setStatusLine: (message: string) => void
  setTextInputDialog: Dispatch<SetStateAction<AppShellTextInputDialogState | null>>
}

function useSkillActions({
  activeProjectDir,
  activeSessionID,
  projects,
  pushToast,
  selectProject,
  setActiveSessionID,
  setComposer,
  setMessages,
  setOpencodeMessages,
  setProjectData,
  setSidebarMode,
  setSkillUseModal,
  setSkills,
  setSkillsError,
  setSkillsLoading,
  setStatusLine,
}: SkillActionsArgs) {
  const loadSkills = useCallback(async () => {
    try {
      setSkillsLoading(true)
      setSkillsError(undefined)
      setSkills(await window.orxa.opencode.listSkills())
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : String(error))
    } finally {
      setSkillsLoading(false)
    }
  }, [setSkills, setSkillsError, setSkillsLoading])

  const openSkillUseModal = useCallback(
    (skill: SkillEntry) => {
      setSkillUseModal({
        skill,
        projectDir: activeProjectDir ?? projects[0]?.worktree ?? '',
      })
    },
    [activeProjectDir, projects, setSkillUseModal]
  )

  const applySkillToProject = useCallback(
    async (skill: SkillEntry, targetProjectDir: string, sessionTarget: SkillPromptTarget) => {
      try {
        const project = projects.find(item => item.worktree === targetProjectDir)
        if (!project) {
          setStatusLine('Select a valid workspace')
          return
        }

        await prepareSkillSession({
          activeProjectDir,
          activeSessionID,
          project,
          selectProject,
          sessionTarget,
          setActiveSessionID,
          setComposer,
          setMessages,
          setOpencodeMessages,
          setProjectData,
          setSidebarMode,
          setSkillUseModal,
          setStatusLine,
          skill,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setStatusLine(message)
        pushToast(message, 'warning')
      }
    },
    [
      activeProjectDir,
      activeSessionID,
      projects,
      pushToast,
      selectProject,
      setActiveSessionID,
      setComposer,
      setMessages,
      setOpencodeMessages,
      setProjectData,
      setSidebarMode,
      setSkillUseModal,
      setStatusLine,
    ]
  )

  return { applySkillToProject, loadSkills, openSkillUseModal }
}

async function prepareSkillSession({
  activeProjectDir,
  activeSessionID,
  project,
  selectProject,
  sessionTarget,
  setActiveSessionID,
  setComposer,
  setMessages,
  setOpencodeMessages,
  setProjectData,
  setSidebarMode,
  setSkillUseModal,
  setStatusLine,
  skill,
}: {
  activeProjectDir: string | undefined
  activeSessionID: string | undefined
  project: ProjectListItem
  selectProject: (directory: string) => Promise<unknown>
  sessionTarget: SkillPromptTarget
  setActiveSessionID: (value: string | undefined) => void
  setComposer: Dispatch<SetStateAction<string>>
  setMessages: SetMessages
  setOpencodeMessages: (
    directory: string,
    sessionID: string,
    messages: SessionMessageBundle[]
  ) => void
  setProjectData: SetProjectData
  setSidebarMode: Dispatch<SetStateAction<SidebarMode>>
  setSkillUseModal: Dispatch<SetStateAction<SkillUseModalState>>
  setStatusLine: (message: string) => void
  skill: SkillEntry
}) {
  const targetProjectDir = project.worktree
  const seedPrompt = [
    `Use skill: ${skill.name}`,
    '',
    skill.description,
    '',
    `Skill path: ${skill.path}`,
    '',
    'Apply this skill to the current task and ask clarifying questions if needed.',
  ].join('\n')

  await selectProject(targetProjectDir)
  const latest = await opencodeClient.refreshProject(targetProjectDir)
  setProjectData(latest as ProjectBootstrap)

  const existingSession = findReusableSkillSession({
    activeProjectDir,
    activeSessionID,
    latest,
    sessionTarget,
    targetProjectDir,
  })
  const targetSessionID =
    existingSession ?? (await opencodeClient.createSession(targetProjectDir, `Skill: ${skill.name}`)).id

  if (existingSession) {
    const messages = await opencodeClient.loadMessages(targetProjectDir, targetSessionID).catch(() => [])
    setOpencodeMessages(targetProjectDir, targetSessionID, messages)
  } else {
    setMessages([])
  }

  setActiveSessionID(targetSessionID)
  setComposer(seedPrompt)
  setSidebarMode('projects')
  setSkillUseModal(null)
  const targetLabel = existingSession ? 'current session' : 'new session'
  const projectLabel = project.name || project.worktree.split('/').at(-1) || project.worktree
  setStatusLine(`Prepared skill prompt for ${projectLabel} (${targetLabel})`)
}

function findReusableSkillSession({
  activeProjectDir,
  activeSessionID,
  latest,
  sessionTarget,
  targetProjectDir,
}: {
  activeProjectDir: string | undefined
  activeSessionID: string | undefined
  latest: ProjectBootstrap
  sessionTarget: SkillPromptTarget
  targetProjectDir: string
}) {
  if (sessionTarget !== 'current' || activeProjectDir !== targetProjectDir || !activeSessionID) {
    return null
  }
  return latest.sessions.some(item => item.id === activeSessionID && !item.time.archived)
    ? activeSessionID
    : null
}

function useDirectoryActions({
  activeProjectDir,
  bootstrap,
  pushToast,
  requestConfirmation,
  selectProject,
  setActiveProjectDir,
  setActiveSessionID,
  setActiveTerminalId,
  setMessages,
  setProjectData,
  setStatusLine,
  setTerminalOpen,
  setTerminalTabs,
}: DirectoryActionsArgs) {
  const addProjectDirectory = useCallback(
    async (options?: { select?: boolean }) => {
      try {
        const result = await opencodeClient.addProjectDirectory()
        if (!result) {
          return undefined
        }
        const directory = result.directory
        await bootstrap()
        if (options?.select !== false) {
          await selectProject(directory)
        }
        setStatusLine(`Workspace added: ${directory}`)
        return directory
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
        return undefined
      }
    },
    [bootstrap, selectProject, setStatusLine]
  )

  const changeProjectDirectory = useCallback(
    async (directory: string, label: string) => {
      try {
        const nextDirectory = await addProjectDirectory()
        if (!nextDirectory) {
          return
        }
        if (nextDirectory === directory) {
          setStatusLine(`Workspace already points to ${nextDirectory}`)
          return
        }
        await opencodeClient.removeProjectDirectory(directory)
        await bootstrap()
        if (activeProjectDir === directory) {
          await selectProject(nextDirectory)
        }
        setStatusLine(`Updated workspace "${label}"`)
        pushToast(`Workspace path updated to ${nextDirectory}`, 'info', 4_000)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setStatusLine(message)
        pushToast(message, 'error')
      }
    },
    [activeProjectDir, addProjectDirectory, bootstrap, pushToast, selectProject, setStatusLine]
  )

  const removeProjectDirectory = useRemoveDirectoryAction({
    activeProjectDir,
    bootstrap,
    requestConfirmation,
    setActiveProjectDir,
    setActiveSessionID,
    setActiveTerminalId,
    setMessages,
    setProjectData,
    setStatusLine,
    setTerminalOpen,
    setTerminalTabs,
  })

  return { addProjectDirectory, changeProjectDirectory, removeProjectDirectory }
}

function useRemoveDirectoryAction({
  activeProjectDir,
  bootstrap,
  requestConfirmation,
  setActiveProjectDir,
  setActiveSessionID,
  setActiveTerminalId,
  setMessages,
  setProjectData,
  setStatusLine,
  setTerminalOpen,
  setTerminalTabs,
}: Pick<
  DirectoryActionsArgs,
  | 'activeProjectDir'
  | 'bootstrap'
  | 'requestConfirmation'
  | 'setActiveProjectDir'
  | 'setActiveSessionID'
  | 'setActiveTerminalId'
  | 'setMessages'
  | 'setProjectData'
  | 'setStatusLine'
  | 'setTerminalOpen'
  | 'setTerminalTabs'
>) {
  return useCallback(
    async (directory: string, label: string) => {
      try {
        const confirmed = await requestConfirmation({
          title: 'Remove workspace',
          message: `Remove "${label}" from Orxa Code workspace list?`,
          confirmLabel: 'Remove',
          cancelLabel: 'Cancel',
          variant: 'danger',
        })
        if (!confirmed) {
          return
        }
        await opencodeClient.removeProjectDirectory(directory)
        if (activeProjectDir === directory) {
          setActiveProjectDir(undefined)
          setProjectData(null)
          setActiveSessionID(undefined)
          setMessages([])
          setTerminalTabs([])
          setActiveTerminalId(undefined)
          setTerminalOpen(false)
        }
        await bootstrap()
        setStatusLine(`Removed workspace: ${label}`)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [
      activeProjectDir,
      bootstrap,
      requestConfirmation,
      setActiveProjectDir,
      setActiveSessionID,
      setActiveTerminalId,
      setMessages,
      setProjectData,
      setStatusLine,
      setTerminalOpen,
      setTerminalTabs,
    ]
  )
}

function useUtilityActions({
  bootstrap,
  selectProject,
  setActiveSessionID,
  setStatusLine,
  setTextInputDialog,
}: WorktreeActionsArgs) {
  const copyProjectPath = useCallback(
    async (directory: string) => {
      try {
        await navigator.clipboard.writeText(directory)
        setStatusLine('Workspace path copied')
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [setStatusLine]
  )

  const createWorktreeSession = useCallback(
    (directory: string, sessionID: string, currentTitle: string) => {
      const suggested = currentTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32)
      setTextInputDialog({
        title: 'New worktree name',
        defaultValue: suggested || 'feature',
        placeholder: 'feature/my-worktree',
        confirmLabel: 'Create',
        validate: value => (!value.trim() ? 'Worktree name is required' : null),
        onConfirm: async value => {
          const nameInput = value.trim()
          if (!nameInput) {
            return
          }
          try {
            const result = await window.orxa.opencode.createWorktreeSession(
              directory,
              sessionID,
              nameInput || undefined
            )
            await bootstrap()
            await selectProject(result.worktree.directory)
            setActiveSessionID(result.session.id)
            setStatusLine(`Worktree session created: ${result.worktree.name}`)
          } catch (error) {
            setStatusLine(error instanceof Error ? error.message : String(error))
          }
        },
      })
    },
    [bootstrap, selectProject, setActiveSessionID, setStatusLine, setTextInputDialog]
  )

  return { copyProjectPath, createWorktreeSession }
}

export function useAppCoreProjectActions(args: UseAppCoreProjectActionsArgs) {
  const directoryActions = useDirectoryActions(args)
  const skillActions = useSkillActions(args)
  const utilityActions = useUtilityActions(args)

  return {
    ...directoryActions,
    ...skillActions,
    ...utilityActions,
  }
}

type UseAppCoreProjectActionsArgs = SkillActionsArgs &
  DirectoryActionsArgs &
  WorktreeActionsArgs
