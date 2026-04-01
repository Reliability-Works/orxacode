import { ipcMain } from 'electron'
import { IPC, type OpenDirectoryTarget } from '../../shared/ipc'
import type { WorktreeCoordinatorService } from '../services/worktree-coordinator-service'
import { assertString } from './validators'

type WorktreeHandlersDeps = {
  worktreeCoordinator: WorktreeCoordinatorService
}

export function registerWorktreeHandlers({ worktreeCoordinator }: WorktreeHandlersDeps) {
  ipcMain.handle(IPC.worktreesList, async (_event, workspaceDir: unknown) =>
    worktreeCoordinator.listWorktrees(assertString(workspaceDir, 'workspaceDir'))
  )
  ipcMain.handle(IPC.worktreesCreate, async (_event, input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Invalid worktree input')
    }
    const record = input as { workspaceDir?: unknown; name?: unknown; baseRef?: unknown }
    return worktreeCoordinator.createWorktree({
      workspaceDir: assertString(record.workspaceDir, 'workspaceDir'),
      name: assertString(record.name, 'name'),
      baseRef: typeof record.baseRef === 'string' ? record.baseRef : undefined,
    })
  })
  ipcMain.handle(IPC.worktreesOpen, async (_event, directory: unknown, target: unknown) =>
    worktreeCoordinator.openWorktree(
      assertString(directory, 'directory'),
      assertString(target, 'target') as OpenDirectoryTarget
    )
  )
  ipcMain.handle(IPC.worktreesDelete, async (_event, workspaceDir: unknown, directory: unknown) =>
    worktreeCoordinator.deleteWorktree(
      assertString(workspaceDir, 'workspaceDir'),
      assertString(directory, 'directory')
    )
  )
}
