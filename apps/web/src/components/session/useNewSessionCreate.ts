import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  type ModelSelection,
  type ProviderKind,
  type ThreadId,
  DEFAULT_RUNTIME_MODE,
} from '@orxa-code/contracts'
import { newCommandId, newThreadId } from '~/lib/utils'
import { ensureNativeApi } from '~/nativeApi'
import { useStore } from '~/store'
import { useComposerDraftStore } from '~/composerDraftStore'

interface CreateSessionInput {
  readonly provider: ProviderKind
  readonly model: string
  readonly agentId?: string | undefined
  readonly projectId?: ReturnType<typeof useStore.getState>['projects'][0]['id'] | null
  readonly navigate?: boolean
}

interface UseNewSessionCreateReturn {
  readonly create: (input: CreateSessionInput) => Promise<ThreadId>
}

function buildModelSelection(input: CreateSessionInput): ModelSelection {
  const kind: ProviderKind = input.provider
  switch (kind) {
    case 'opencode':
      return {
        provider: 'opencode',
        model: input.model,
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      }
    case 'claudeAgent':
      return { provider: 'claudeAgent', model: input.model }
    case 'codex':
      return { provider: 'codex', model: input.model }
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

function getDefaultProjectId(): ReturnType<typeof useStore.getState>['projects'][0]['id'] | null {
  const { projects } = useStore.getState()
  return projects[0]?.id ?? null
}

export function useNewSessionCreate(): UseNewSessionCreateReturn {
  const navigate = useNavigate()

  const create = useCallback(
    async (input: CreateSessionInput): Promise<ThreadId> => {
      const api = ensureNativeApi()
      const projectId = input.projectId ?? getDefaultProjectId()
      if (!projectId) throw new Error('No project available to create a session in.')

      const threadId = newThreadId()
      const modelSelection = buildModelSelection(input)
      const createdAt = new Date().toISOString()
      const draftStore = useComposerDraftStore.getState()

      draftStore.setProjectDraftThreadId(projectId, threadId, {
        branch: null,
        worktreePath: null,
        createdAt,
        envMode: 'local',
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: 'default',
      })
      draftStore.applyStickyState(threadId)
      draftStore.setStickyModelSelection(modelSelection)
      draftStore.setModelSelection(threadId, modelSelection)

      try {
        await api.orchestration.dispatchCommand({
          type: 'thread.create',
          commandId: newCommandId(),
          threadId,
          projectId,
          title: 'New session',
          modelSelection,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: 'default',
          branch: null,
          worktreePath: null,
          createdAt,
        })
      } catch (error) {
        draftStore.clearDraftThread(threadId)
        draftStore.clearProjectDraftThreadById(projectId, threadId)
        throw error
      }

      if (input.navigate !== false) {
        await navigate({ to: '/$threadId', params: { threadId } })
      }
      return threadId
    },
    [navigate]
  )

  return { create }
}
