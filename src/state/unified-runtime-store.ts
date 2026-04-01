import { create } from 'zustand'
import { createUnifiedRuntimeAgentActions } from './unified-runtime-store-agent-actions'
import {
  createUnifiedRuntimeBaseActions,
  createUnifiedRuntimeBaseState,
} from './unified-runtime-store-base-actions'
import type { UnifiedRuntimeStoreState } from './unified-runtime-store-types'

export const useUnifiedRuntimeStore = create<UnifiedRuntimeStoreState>(set => ({
  ...createUnifiedRuntimeBaseState(),
  ...createUnifiedRuntimeBaseActions(set),
  ...createUnifiedRuntimeAgentActions(set),
}))

export * from './unified-runtime-store-selectors'
export type {
  CachedSessionEntry,
  UnifiedClaudeSessionRuntime,
  UnifiedRuntimeStoreSet,
  UnifiedRuntimeStoreState,
  UnifiedWorkspaceMeta,
} from './unified-runtime-store-types'
