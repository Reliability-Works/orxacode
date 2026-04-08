/**
 * Project script management callbacks extracted from useChatViewBehavior2.
 */

import { useCallback } from 'react'
import { type KeybindingCommand, type ProjectId, type ProjectScript } from '@orxa-code/contracts'
import { newCommandId } from '~/lib/utils'
import { readNativeApi } from '~/nativeApi'
import { isElectron } from '../../env'
import { commandForProjectScript, nextProjectScriptId } from '../../projectScripts'
import { decodeProjectScriptKeybindingRule } from '~/lib/projectScriptKeybindings'
import { toastManager } from '../ui/toastState'
import type { NewProjectScriptInput } from '../ProjectScriptsControl'
import type { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import type { useChatViewDerivedThread } from './useChatViewDerivedThread'

type S = ReturnType<typeof useChatViewStoreSelectors>
type T = ReturnType<typeof useChatViewDerivedThread>

export async function executePersistScripts(input: {
  projectId: ProjectId
  nextScripts: ProjectScript[]
  keybinding?: string | null
  keybindingCommand: KeybindingCommand
}): Promise<void> {
  const api = readNativeApi()
  if (!api) return
  await api.orchestration.dispatchCommand({
    type: 'project.meta.update',
    commandId: newCommandId(),
    projectId: input.projectId,
    scripts: input.nextScripts,
  })
  const rule = decodeProjectScriptKeybindingRule({
    keybinding: input.keybinding,
    command: input.keybindingCommand,
  })
  if (isElectron && rule) await api.server.upsertKeybinding(rule)
}

type PersistScriptsFn = (input: {
  projectId: ProjectId
  projectCwd: string
  previousScripts: ProjectScript[]
  nextScripts: ProjectScript[]
  keybinding?: string | null
  keybindingCommand: KeybindingCommand
}) => Promise<void>

function useSaveProjectScript(td: T, persistProjectScripts: PersistScriptsFn) {
  const { activeProject } = td
  return useCallback(
    async (input: NewProjectScriptInput) => {
      if (!activeProject) return
      const nextId = nextProjectScriptId(
        input.name,
        activeProject.scripts.map((s: ProjectScript) => s.id)
      )
      const nextScript: ProjectScript = {
        id: nextId,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
      }
      const nextScripts = input.runOnWorktreeCreate
        ? [
            ...activeProject.scripts.map((s: ProjectScript) =>
              s.runOnWorktreeCreate ? { ...s, runOnWorktreeCreate: false } : s
            ),
            nextScript,
          ]
        : [...activeProject.scripts, nextScript]
      await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.cwd,
        previousScripts: activeProject.scripts,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(nextId),
      })
    },
    [activeProject, persistProjectScripts]
  )
}

function useUpdateProjectScript(td: T, persistProjectScripts: PersistScriptsFn) {
  const { activeProject } = td
  return useCallback(
    async (scriptId: string, input: NewProjectScriptInput) => {
      if (!activeProject) return
      const existing = activeProject.scripts.find((s: ProjectScript) => s.id === scriptId)
      if (!existing) throw new Error('Script not found.')
      const updated: ProjectScript = {
        ...existing,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
      }
      const nextScripts = activeProject.scripts.map((s: ProjectScript) =>
        s.id === scriptId
          ? updated
          : input.runOnWorktreeCreate
            ? { ...s, runOnWorktreeCreate: false }
            : s
      )
      await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.cwd,
        previousScripts: activeProject.scripts,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(scriptId),
      })
    },
    [activeProject, persistProjectScripts]
  )
}

function useDeleteProjectScript(td: T, persistProjectScripts: PersistScriptsFn) {
  const { activeProject } = td
  return useCallback(
    async (scriptId: string) => {
      if (!activeProject) return
      const deletedName = activeProject.scripts.find((s: ProjectScript) => s.id === scriptId)?.name
      const nextScripts = activeProject.scripts.filter((s: ProjectScript) => s.id !== scriptId)
      try {
        await persistProjectScripts({
          projectId: activeProject.id,
          projectCwd: activeProject.cwd,
          previousScripts: activeProject.scripts,
          nextScripts,
          keybinding: null,
          keybindingCommand: commandForProjectScript(scriptId),
        })
        toastManager.add({
          type: 'success',
          title: `Deleted action "${deletedName ?? 'Unknown'}"`,
        })
      } catch (error) {
        toastManager.add({
          type: 'error',
          title: 'Could not delete action',
          description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        })
      }
    },
    [activeProject, persistProjectScripts]
  )
}

export function useProjectScriptCallbacks(store: S, td: T) {
  void store
  const persistProjectScripts: PersistScriptsFn = useCallback(async input => {
    await executePersistScripts(input)
  }, [])
  const saveProjectScript = useSaveProjectScript(td, persistProjectScripts)
  const updateProjectScript = useUpdateProjectScript(td, persistProjectScripts)
  const deleteProjectScript = useDeleteProjectScript(td, persistProjectScripts)
  return { persistProjectScripts, saveProjectScript, updateProjectScript, deleteProjectScript }
}
