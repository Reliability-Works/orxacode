import { useCallback } from 'react'
import type {
  KanbanBoardSnapshot,
  KanbanColumnId,
  KanbanLegacyImportInput,
  KanbanProvider,
  KanbanTaskProviderConfig,
  KanbanWorkspace,
} from '@shared/ipc'
import {
  readPersistedValue,
  removePersistedValue,
  writePersistedValue,
} from '../../lib/persistence'

export const JOBS_KEY = 'orxa:jobs:v1'
export const JOB_RUNS_KEY = 'orxa:jobRuns:v1'
export const KANBAN_MIGRATION_KEY = 'orxa:kanban:migratedJobs:v1'

export type TaskDraft = {
  title: string
  prompt: string
  description: string
  provider: KanbanProvider
  providerConfig?: KanbanTaskProviderConfig
  columnId: KanbanColumnId
  autoStartWhenUnblocked: boolean
}

export function extractEventTaskId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const data = payload as {
    taskId?: unknown
    task?: { id?: unknown }
    run?: { taskId?: unknown }
    runtime?: { taskId?: unknown }
    checkpoint?: { taskId?: unknown }
    worktree?: { taskId?: unknown }
  }
  if (typeof data.taskId === 'string') return data.taskId
  if (typeof data.task?.id === 'string') return data.task.id
  if (typeof data.run?.taskId === 'string') return data.run.taskId
  if (typeof data.runtime?.taskId === 'string') return data.runtime.taskId
  if (typeof data.checkpoint?.taskId === 'string') return data.checkpoint.taskId
  if (typeof data.worktree?.taskId === 'string') return data.worktree.taskId
  return null
}

export function workspaceLabel(workspaces: KanbanWorkspace[], workspaceDir: string) {
  const workspace = workspaces.find(item => item.directory === workspaceDir)
  return workspace?.name || workspaceDir.split('/').at(-1) || workspaceDir
}

export function taskProviderDefaults(
  settings: KanbanBoardSnapshot['settings'] | null | undefined,
  provider: KanbanProvider
): KanbanTaskProviderConfig | undefined {
  if (!settings?.providerDefaults) {
    return undefined
  }
  if (provider === 'opencode' && settings.providerDefaults.opencode) {
    return { opencode: settings.providerDefaults.opencode }
  }
  if (provider === 'codex' && settings.providerDefaults.codex) {
    return { codex: settings.providerDefaults.codex }
  }
  if (provider === 'claude' && settings.providerDefaults.claude) {
    return { claude: settings.providerDefaults.claude }
  }
  return undefined
}

export function createTaskDraft(
  settings: KanbanBoardSnapshot['settings'] | null | undefined,
  provider?: KanbanProvider
): TaskDraft {
  const nextProvider = provider ?? settings?.defaultProvider ?? 'opencode'
  return {
    title: '',
    prompt: '',
    description: '',
    provider: nextProvider,
    providerConfig: taskProviderDefaults(settings, nextProvider),
    columnId: 'backlog',
    autoStartWhenUnblocked: false,
  }
}

function readLegacyJobsMigrationStatus() {
  return readPersistedValue(KANBAN_MIGRATION_KEY)
}

export function useLegacyJobsMigration() {
  return useCallback(async () => {
    if (readLegacyJobsMigrationStatus() === 'done') {
      return
    }
    const rawJobs = readPersistedValue(JOBS_KEY)
    const rawRuns = readPersistedValue(JOB_RUNS_KEY)
    if (!rawJobs && !rawRuns) {
      writePersistedValue(KANBAN_MIGRATION_KEY, 'done')
      return
    }
    const input: KanbanLegacyImportInput = {
      jobs: rawJobs ? (JSON.parse(rawJobs) as KanbanLegacyImportInput['jobs']) : [],
      runs: rawRuns ? (JSON.parse(rawRuns) as KanbanLegacyImportInput['runs']) : [],
    }
    await window.orxa.kanban.importLegacyJobs(input)
    removePersistedValue(JOBS_KEY)
    removePersistedValue(JOB_RUNS_KEY)
    writePersistedValue(KANBAN_MIGRATION_KEY, 'done')
  }, [])
}
