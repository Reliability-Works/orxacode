/**
 * useSidebarAddProject — add-project sub-hook split out of
 * useSidebarProjectActions to keep hook bodies under the line limit.
 */

import { useCallback, useRef, useState } from 'react'
import type { ProjectId } from '@orxa-code/contracts'
import type { SidebarThreadSortOrder } from '@orxa-code/contracts/settings'
import { readNativeApi } from '../../nativeApi'
import { sortThreadsForSidebar } from '../Sidebar.logic'
import type { Project } from '../../types'
import type { SidebarThreadSnapshot } from './ThreadRow'
import { execAddProjectFromPath } from './projectActionHelpers'
import { toastManager } from '../ui/toastState'

export interface UseSidebarAddProjectParams {
  projects: Project[]
  appSettings: {
    sidebarThreadSortOrder: string
  }
  navigate: ReturnType<typeof import('@tanstack/react-router').useNavigate>
  threads: SidebarThreadSnapshot[]
  shouldBrowseForProjectImmediately: boolean
}

function useFocusMostRecentThreadForProject(
  threads: SidebarThreadSnapshot[],
  sidebarThreadSortOrder: string,
  navigate: ReturnType<typeof import('@tanstack/react-router').useNavigate>
) {
  return useCallback(
    (projectId: ProjectId) => {
      const latest = sortThreadsForSidebar(
        threads.filter(t => t.projectId === projectId && t.archivedAt === null),
        sidebarThreadSortOrder as SidebarThreadSortOrder
      )[0]
      if (latest) void navigate({ to: '/$threadId', params: { threadId: latest.id } })
    },
    [navigate, sidebarThreadSortOrder, threads]
  )
}

export interface AddProjectState {
  addingProject: boolean
  setAddingProject: React.Dispatch<React.SetStateAction<boolean>>
  newCwd: string
  setNewCwd: React.Dispatch<React.SetStateAction<string>>
  isPickingFolder: boolean
  setIsPickingFolder: React.Dispatch<React.SetStateAction<boolean>>
  isAddingProject: boolean
  setIsAddingProject: React.Dispatch<React.SetStateAction<boolean>>
  addProjectError: string | null
  setAddProjectError: React.Dispatch<React.SetStateAction<string | null>>
  addProjectInputRef: React.RefObject<HTMLInputElement | null>
}

function useAddProjectState(): AddProjectState {
  const [addingProject, setAddingProject] = useState(false)
  const [newCwd, setNewCwd] = useState('')
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const [isAddingProject, setIsAddingProject] = useState(false)
  const [addProjectError, setAddProjectError] = useState<string | null>(null)
  const addProjectInputRef = useRef<HTMLInputElement | null>(null)
  return {
    addingProject,
    setAddingProject,
    newCwd,
    setNewCwd,
    isPickingFolder,
    setIsPickingFolder,
    isAddingProject,
    setIsAddingProject,
    addProjectError,
    setAddProjectError,
    addProjectInputRef,
  }
}

function useAddProjectFromPath(params: {
  state: AddProjectState
  projects: Project[]
  shouldBrowseForProjectImmediately: boolean
  focusMostRecentThreadForProject: (projectId: ProjectId) => void
}) {
  const { state, projects, shouldBrowseForProjectImmediately, focusMostRecentThreadForProject } =
    params
  const { isAddingProject, setIsAddingProject, setNewCwd, setAddProjectError, setAddingProject } =
    state
  return useCallback(
    async (rawCwd: string) => {
      await execAddProjectFromPath({
        rawCwd,
        isAddingProject,
        projects,
        shouldBrowseForProjectImmediately,
        focusMostRecentThreadForProject,
        setIsAddingProject,
        setNewCwd,
        setAddProjectError,
        setAddingProject,
      })
    },
    [
      focusMostRecentThreadForProject,
      isAddingProject,
      projects,
      setAddProjectError,
      setAddingProject,
      setIsAddingProject,
      setNewCwd,
      shouldBrowseForProjectImmediately,
    ]
  )
}

function buildPickFolderHandler(params: {
  state: AddProjectState
  shouldBrowseForProjectImmediately: boolean
  addProjectFromPath: (rawCwd: string) => Promise<void>
}) {
  const { state, shouldBrowseForProjectImmediately, addProjectFromPath } = params
  return async () => {
    const api = readNativeApi()
    if (!api || state.isPickingFolder) return
    state.setIsPickingFolder(true)
    let picked: string | null = null
    try {
      picked = await api.dialogs.pickFolder()
    } catch (error) {
      const description =
        error instanceof Error ? error.message : 'An error occurred while selecting a folder.'
      if (shouldBrowseForProjectImmediately) {
        toastManager.add({ type: 'error', title: 'Failed to add project', description })
      } else {
        state.setAddProjectError(description)
        state.addProjectInputRef.current?.focus()
      }
    } finally {
      state.setIsPickingFolder(false)
    }

    if (!picked) {
      if (!shouldBrowseForProjectImmediately) {
        state.addProjectInputRef.current?.focus()
      }
      return
    }

    await addProjectFromPath(picked)
  }
}

export function useSidebarAddProject(params: UseSidebarAddProjectParams) {
  const { projects, appSettings, navigate, threads, shouldBrowseForProjectImmediately } = params
  const state = useAddProjectState()

  const focusMostRecentThreadForProject = useFocusMostRecentThreadForProject(
    threads,
    appSettings.sidebarThreadSortOrder,
    navigate
  )

  const addProjectFromPath = useAddProjectFromPath({
    state,
    projects,
    shouldBrowseForProjectImmediately,
    focusMostRecentThreadForProject,
  })

  const canAddProject = state.newCwd.trim().length > 0 && !state.isAddingProject
  const handleAddProject = () => void addProjectFromPath(state.newCwd)
  const handlePickFolder = buildPickFolderHandler({
    state,
    shouldBrowseForProjectImmediately,
    addProjectFromPath,
  })
  const handleStartAddProject = () => {
    state.setAddProjectError(null)
    if (shouldBrowseForProjectImmediately) {
      void handlePickFolder()
      return
    }
    state.setAddingProject(prev => !prev)
  }

  return {
    ...state,
    canAddProject,
    focusMostRecentThreadForProject,
    addProjectFromPath,
    handleAddProject,
    handlePickFolder,
    handleStartAddProject,
  }
}
