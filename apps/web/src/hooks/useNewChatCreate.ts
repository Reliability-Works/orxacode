import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { type ProviderKind, type ThreadId, DEFAULT_RUNTIME_MODE } from '@orxa-code/contracts'

import { newCommandId, newProjectId, newThreadId } from '../lib/utils'
import { ensureNativeApi } from '../nativeApi'
import { toastManager } from '../components/ui/toastState'
import {
  buildSessionModelSelection,
  clearDraftThreadAfterCreationFailure,
  seedDraftThreadForCreation,
} from '../lib/sessionCreate'

interface CreateChatInput {
  readonly provider: ProviderKind
  readonly model: string
  readonly agentId?: string | undefined
}

interface UseNewChatCreateReturn {
  readonly create: (input: CreateChatInput) => Promise<ThreadId | null>
}

function deriveProjectTitleFromCwd(cwd: string): string {
  const parts = cwd.split(/[/\\]/).filter(part => part.length > 0)
  return parts[parts.length - 1] ?? 'New chat'
}

export function useNewChatCreate(): UseNewChatCreateReturn {
  const navigate = useNavigate()

  const create = useCallback(
    async (input: CreateChatInput): Promise<ThreadId | null> => {
      const api = ensureNativeApi()
      let materialized: { cwd: string }
      try {
        materialized = await api.chats.materializeDir({})
      } catch (error) {
        const description =
          error instanceof Error ? error.message : 'Could not create chat directory.'
        toastManager.add({ type: 'error', title: 'Failed to start chat', description })
        return null
      }
      const cwd = materialized.cwd
      const projectId = newProjectId()
      const threadId = newThreadId()
      const modelSelection = buildSessionModelSelection(input)
      const createdAt = new Date().toISOString()
      const title = deriveProjectTitleFromCwd(cwd)
      seedDraftThreadForCreation({ projectId, threadId, createdAt, modelSelection })
      try {
        await api.orchestration.dispatchCommand({
          type: 'project.create',
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot: cwd,
          defaultModelSelection: modelSelection,
          createdAt,
        })
        await api.orchestration.dispatchCommand({
          type: 'thread.create',
          commandId: newCommandId(),
          threadId,
          projectId,
          title,
          modelSelection,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: 'default',
          branch: null,
          worktreePath: null,
          gitRoot: null,
          createdAt,
        })
      } catch (error) {
        clearDraftThreadAfterCreationFailure(projectId, threadId)
        const description = error instanceof Error ? error.message : 'Failed to create chat.'
        toastManager.add({ type: 'error', title: 'Failed to start chat', description })
        try {
          await api.chats.removeDir({ cwd })
        } catch {
          // best-effort cleanup
        }
        return null
      }
      await navigate({ to: '/$threadId', params: { threadId } })
      return threadId
    },
    [navigate]
  )

  return { create }
}
