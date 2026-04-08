/**
 * Consolidates all store subscriptions for ChatView into a single hook.
 *
 * Only pure store subscriptions that do not depend on local derived state
 * belong here. Queries that depend on derived values (gitCwd, etc.) are called
 * separately in the ChatView function body.
 */

import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useTheme } from '../../hooks/useTheme'
import { useSettings } from '../../hooks/useSettings'
import { useStore } from '../../store'
import { useProjectById, useThreadById } from '../../storeSelectors'
import { useUiStateStore } from '../../uiStateStore'
import { useComposerDraftStore, useComposerThreadDraft } from '../../composerDraftStore'
import { useTerminalStateStore, selectThreadTerminalState } from '../../terminalStateStore'
import { useServerConfig, useServerKeybindings, useServerAvailableEditors } from '~/rpc/serverState'
import { gitCreateWorktreeMutationOptions } from '~/lib/gitReactQuery'
import { parseDiffRouteSearch } from '../../diffRouteSearch'
import { deriveComposerSendState } from '../ChatView.logic'
import type { ThreadId } from '@orxa-code/contracts'
import { useChatViewComposerDraftActions } from './useChatViewStoreSelectors.composer'

export function useChatViewStoreSelectors(threadId: ThreadId) {
  const serverThread = useThreadById(threadId)
  const setStoreThreadError = useStore(s => s.setError)
  const setStoreThreadBranch = useStore(s => s.setThreadBranch)
  const markThreadVisited = useUiStateStore(s => s.markThreadVisited)
  const activeThreadLastVisitedAt = useUiStateStore(s => s.threadLastVisitedAtById[threadId])
  const settings = useSettings()
  const navigate = useNavigate()
  const rawSearch = useSearch({ strict: false, select: params => parseDiffRouteSearch(params) })
  const { resolvedTheme } = useTheme()
  const queryClient = useQueryClient()
  const createWorktreeMutation = useMutation(gitCreateWorktreeMutationOptions({ queryClient }))
  const composerDraft = useComposerThreadDraft(threadId)
  const prompt = composerDraft.prompt
  const composerImages = composerDraft.images
  const composerTerminalContexts = composerDraft.terminalContexts
  const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds
  const composerSendState = useMemo(
    () =>
      deriveComposerSendState({
        prompt,
        imageCount: composerImages.length,
        terminalContexts: composerTerminalContexts,
      }),
    [composerImages.length, composerTerminalContexts, prompt]
  )
  const composerDraftActions = useChatViewComposerDraftActions()
  const draftThread = useComposerDraftStore(s => s.draftThreadsByThreadId[threadId] ?? null)
  const fallbackDraftProject = useProjectById(draftThread?.projectId ?? null)
  const terminalState = useTerminalStateStore(s =>
    selectThreadTerminalState(s.terminalStateByThreadId, threadId)
  )
  const storeSetTerminalOpen = useTerminalStateStore(s => s.setTerminalOpen)
  const storeSetTerminalHeight = useTerminalStateStore(s => s.setTerminalHeight)
  const storeSplitTerminal = useTerminalStateStore(s => s.splitTerminal)
  const storeNewTerminal = useTerminalStateStore(s => s.newTerminal)
  const storeSetActiveTerminal = useTerminalStateStore(s => s.setActiveTerminal)
  const storeCloseTerminal = useTerminalStateStore(s => s.closeTerminal)
  const serverConfig = useServerConfig()
  const keybindings = useServerKeybindings()
  const availableEditors = useServerAvailableEditors()

  return {
    serverThread,
    setStoreThreadError,
    setStoreThreadBranch,
    markThreadVisited,
    activeThreadLastVisitedAt,
    settings,
    navigate,
    rawSearch,
    resolvedTheme,
    createWorktreeMutation,
    composerDraft,
    prompt,
    composerImages,
    composerTerminalContexts,
    nonPersistedComposerImageIds,
    composerSendState,
    ...composerDraftActions,
    draftThread,
    fallbackDraftProject,
    terminalState,
    storeSetTerminalOpen,
    storeSetTerminalHeight,
    storeSplitTerminal,
    storeNewTerminal,
    storeSetActiveTerminal,
    storeCloseTerminal,
    serverConfig,
    keybindings,
    availableEditors,
  }
}
