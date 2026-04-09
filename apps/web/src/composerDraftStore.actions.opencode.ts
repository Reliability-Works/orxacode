/**
 * Opencode-specific composer draft actions — agent/variant updaters that
 * preserve other fields in the opencode model selection.
 *
 * Split from composerDraftStore.actions.content.ts to respect max-lines.
 */
import { type ModelSelection, type ThreadId, DEFAULT_MODEL_BY_PROVIDER } from '@orxa-code/contracts'
import * as Equal from 'effect/Equal'
import { createEmptyThreadDraft, updateDraftByThreadId } from './composerDraftStore.state'
import type { SetState } from './composerDraftStore.actions.content'

type OpencodeSelection = Extract<ModelSelection, { provider: 'opencode' }>

function updateOpencodeSelection(
  set: SetState,
  threadId: ThreadId,
  updater: (current: OpencodeSelection) => OpencodeSelection
): void {
  if (threadId.length === 0) return
  set(state => {
    const existing = state.draftsByThreadId[threadId]
    const base = existing ?? createEmptyThreadDraft()
    const current = base.modelSelectionByProvider.opencode
    const baseSelection: OpencodeSelection =
      current?.provider === 'opencode'
        ? current
        : ({
            provider: 'opencode',
            model: current?.model ?? DEFAULT_MODEL_BY_PROVIDER.opencode,
          } as OpencodeSelection)
    const nextSelection = updater(baseSelection)
    if (Equal.equals(current, nextSelection)) return state
    const nextMap = { ...base.modelSelectionByProvider, opencode: nextSelection }
    const nextState = updateDraftByThreadId(state, threadId, {
      ...base,
      modelSelectionByProvider: nextMap,
    })
    return {
      ...nextState,
      stickyModelSelectionByProvider: {
        ...state.stickyModelSelectionByProvider,
        opencode: nextSelection,
      },
      stickyActiveProvider: base.activeProvider ?? 'opencode',
    }
  })
}

function omitKey<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const next = { ...obj }
  delete next[key]
  return next
}

export function actionSetOpencodeAgentId(
  set: SetState,
  threadId: ThreadId,
  agentId: string | null
): void {
  updateOpencodeSelection(set, threadId, current => {
    const rest = omitKey(current, 'agentId') as OpencodeSelection
    return agentId ? ({ ...rest, agentId } as OpencodeSelection) : rest
  })
}

export function actionSetOpencodeVariant(
  set: SetState,
  threadId: ThreadId,
  variant: string | null
): void {
  updateOpencodeSelection(set, threadId, current => {
    const rest = omitKey(current, 'variant') as OpencodeSelection
    return variant ? ({ ...rest, variant } as OpencodeSelection) : rest
  })
}
