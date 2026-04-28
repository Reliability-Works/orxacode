import {
  type ModelSelection,
  type ProjectId,
  type ProviderKind,
  type ThreadId,
  DEFAULT_RUNTIME_MODE,
} from '@orxa-code/contracts'

import { useComposerDraftStore } from '../composerDraftStore'

export interface SessionModelSelectionInput {
  readonly provider: ProviderKind
  readonly model: string
  readonly agentId?: string | undefined
}

export function buildSessionModelSelection(input: SessionModelSelectionInput): ModelSelection {
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

export function seedDraftThreadForCreation(args: {
  projectId: ProjectId
  threadId: ThreadId
  createdAt: string
  modelSelection: ModelSelection
}): void {
  const draftStore = useComposerDraftStore.getState()
  draftStore.setProjectDraftThreadId(args.projectId, args.threadId, {
    branch: null,
    worktreePath: null,
    createdAt: args.createdAt,
    envMode: 'local',
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: 'default',
  })
  draftStore.applyStickyState(args.threadId)
  draftStore.setStickyModelSelection(args.modelSelection)
  draftStore.setModelSelection(args.threadId, args.modelSelection)
}

export function clearDraftThreadAfterCreationFailure(
  projectId: ProjectId,
  threadId: ThreadId
): void {
  const draftStore = useComposerDraftStore.getState()
  draftStore.clearDraftThread(threadId)
  draftStore.clearProjectDraftThreadById(projectId, threadId)
}
