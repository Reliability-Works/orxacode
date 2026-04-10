/**
 * projectActionHelpers — pure async helpers for project add / context-menu
 * actions. Extracted from useSidebarProjectActions to keep that file under
 * the max-lines limit.
 */

import { ProjectId, DEFAULT_MODEL_BY_PROVIDER } from '@orxa-code/contracts'
import { isNonEmpty as isNonEmptyString } from 'effect/String'
import { newCommandId, newProjectId } from '../../lib/utils'
import { readNativeApi } from '../../nativeApi'
import { toastManager } from '../ui/toastState'
import type { Project } from '../../types'
import type { SidebarThreadSnapshot } from './ThreadRow'
import type { DraftThreadEnvMode } from '../../composerDraftStore'

const ADD_PROJECT_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      value => {
        clearTimeout(timeout)
        resolve(value)
      },
      error => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

export interface ExecAddProjectFromPathOpts {
  rawCwd: string
  isAddingProject: boolean
  projects: Project[]
  shouldBrowseForProjectImmediately: boolean
  appSettings: { defaultThreadEnvMode: DraftThreadEnvMode }
  handleNewThread: (
    projectId: ProjectId,
    options?: { envMode?: DraftThreadEnvMode }
  ) => Promise<void>
  focusMostRecentThreadForProject: (projectId: ProjectId) => void
  setIsAddingProject: React.Dispatch<React.SetStateAction<boolean>>
  setNewCwd: React.Dispatch<React.SetStateAction<string>>
  setAddProjectError: React.Dispatch<React.SetStateAction<string | null>>
  setAddingProject: React.Dispatch<React.SetStateAction<boolean>>
}

export async function execAddProjectFromPath(opts: ExecAddProjectFromPathOpts): Promise<void> {
  const cwd = opts.rawCwd.trim()
  if (!cwd || opts.isAddingProject) return
  const api = readNativeApi()
  if (!api) return
  opts.setIsAddingProject(true)
  const finish = () => {
    opts.setIsAddingProject(false)
    opts.setNewCwd('')
    opts.setAddProjectError(null)
    opts.setAddingProject(false)
  }
  const existing = opts.projects.find(p => p.cwd === cwd)
  if (existing) {
    opts.focusMostRecentThreadForProject(existing.id)
    finish()
    return
  }
  const projectId = newProjectId()
  const title = cwd.split(/[/\\]/).findLast(isNonEmptyString) ?? cwd
  try {
    await withTimeout(
      api.orchestration.dispatchCommand({
        type: 'project.create',
        commandId: newCommandId(),
        projectId,
        title,
        workspaceRoot: cwd,
        defaultModelSelection: { provider: 'codex', model: DEFAULT_MODEL_BY_PROVIDER.codex },
        createdAt: new Date().toISOString(),
      }),
      ADD_PROJECT_TIMEOUT_MS,
      'Timed out while adding the project. Please try again.'
    )
    await opts
      .handleNewThread(projectId, { envMode: opts.appSettings.defaultThreadEnvMode })
      .catch(() => undefined)
  } catch (error) {
    const description =
      error instanceof Error ? error.message : 'An error occurred while adding the project.'
    opts.setIsAddingProject(false)
    if (opts.shouldBrowseForProjectImmediately) {
      toastManager.add({ type: 'error', title: 'Failed to add project', description })
    } else {
      opts.setAddProjectError(description)
    }
    return
  }
  finish()
}

export interface ExecProjectContextMenuOpts {
  projectId: ProjectId
  position: { x: number; y: number }
  projects: Project[]
  threads: SidebarThreadSnapshot[]
  copyPathToClipboard: (path: string, ctx: { path: string }) => void
  getDraftThreadByProjectId: (
    projectId: ProjectId
  ) => { threadId: import('@orxa-code/contracts').ThreadId } | null
  clearComposerDraftForThread: (threadId: import('@orxa-code/contracts').ThreadId) => void
  clearProjectDraftThreadId: (projectId: ProjectId) => void
}

export function hasRemovableProjectBlockers(
  threads: ReadonlyArray<Pick<SidebarThreadSnapshot, 'projectId' | 'archivedAt'>>,
  projectId: ProjectId
): boolean {
  return threads.some(thread => thread.projectId === projectId && thread.archivedAt === null)
}

export async function execProjectContextMenu(opts: ExecProjectContextMenuOpts): Promise<void> {
  const api = readNativeApi()
  if (!api) return
  const project = opts.projects.find(e => e.id === opts.projectId)
  if (!project) return
  const clicked = await api.contextMenu.show(
    [
      { id: 'copy-path', label: 'Copy Project Path' },
      { id: 'delete', label: 'Remove project', destructive: true },
    ],
    opts.position
  )
  if (clicked === 'copy-path') {
    opts.copyPathToClipboard(project.cwd, { path: project.cwd })
    return
  }
  if (clicked !== 'delete') return
  if (hasRemovableProjectBlockers(opts.threads, opts.projectId)) {
    toastManager.add({
      type: 'warning',
      title: 'Project is not empty',
      description: 'Delete all threads in this project before removing it.',
    })
    return
  }
  const confirmed = await api.dialogs.confirm(`Remove project "${project.name}"?`)
  if (!confirmed) return
  try {
    const draft = opts.getDraftThreadByProjectId(opts.projectId)
    if (draft) opts.clearComposerDraftForThread(draft.threadId)
    opts.clearProjectDraftThreadId(opts.projectId)
    await api.orchestration.dispatchCommand({
      type: 'project.delete',
      commandId: newCommandId(),
      projectId: opts.projectId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error removing project.'
    console.error('Failed to remove project', { projectId: opts.projectId, error })
    toastManager.add({
      type: 'error',
      title: `Failed to remove "${project.name}"`,
      description: message,
    })
  }
}
