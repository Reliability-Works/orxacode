/**
 * Send action hooks for ChatView.
 *
 * The `onSend` handler is split into focused sub-functions that each have
 * complexity ≤20 and ≤75 lines. Pure async helpers live in sibling files so
 * they don't contribute to hook body line counts.
 */

import { useCallback, useRef } from 'react'
import {
  type ModelSelection,
  type ProviderKind,
  type ServerProvider,
  type RuntimeMode,
  type ProviderInteractionMode,
} from '@orxa-code/contracts'
import { type TerminalContextDraft } from '../../lib/terminalContext'
import { parseStandaloneComposerSlashCommand } from '../../composer-logic'
import { buildExpiredTerminalContextToastCopy, deriveComposerSendState } from '../ChatView.logic'
import type { ComposerImageAttachment, DraftThreadEnvMode } from '../../composerDraftStore'
import type { Thread } from '../../types'
import { readNativeApi } from '~/nativeApi'
import { toastManager } from '../ui/toastState'
import { resolvePlanFollowUpSubmission } from '../../proposedPlan'
import { executeSend } from './useChatSendAction.execute'
import type {
  CreateWorktreeMutation,
  PersistThreadSettingsForNextTurn,
  RunProjectScriptFn,
  SendStateRefsAndCallbacks,
} from './useChatSendAction.types'

export { formatOutgoingPrompt } from './useChatSendAction.helpers'

// ---------------------------------------------------------------------------
// useChatSendInFlight — tracks whether a send is in progress
// ---------------------------------------------------------------------------

export function useChatSendInFlight() {
  return useRef(false)
}

// ---------------------------------------------------------------------------
// Types for the hook input
// ---------------------------------------------------------------------------

export interface SendActionInput extends SendStateRefsAndCallbacks {
  activeThread: Thread | null
  activeProject: {
    id: import('@orxa-code/contracts').ProjectId
    cwd: string
    scripts: import('@orxa-code/contracts').ProjectScript[]
    defaultModelSelection?: ModelSelection | null
  } | null
  isServerThread: boolean
  isLocalDraftThread: boolean
  envMode: DraftThreadEnvMode
  composerImages: ComposerImageAttachment[]
  composerTerminalContexts: TerminalContextDraft[]
  selectedProvider: ProviderKind
  selectedModel: string
  selectedProviderModels: ReadonlyArray<ServerProvider['models'][number]>
  selectedPromptEffort: string | null
  selectedModelSelection: ModelSelection
  runtimeMode: RuntimeMode
  interactionMode: ProviderInteractionMode
  isSendBusy: boolean
  isConnecting: boolean
  showPlanFollowUpPrompt: boolean
  activeProposedPlan: { id: string; planMarkdown: string } | null
  activePendingProgress: {
    customAnswer: string
    isLastQuestion: boolean
    questionIndex: number
    canAdvance: boolean
    activeQuestion: { id: string } | null
  } | null
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void
  onSubmitPlanFollowUp: (input: {
    text: string
    interactionMode: 'default' | 'plan'
  }) => Promise<void>
  onAdvanceActivePendingUserInput: () => void
  persistThreadSettingsForNextTurn: PersistThreadSettingsForNextTurn
  runProjectScript: RunProjectScriptFn
  createWorktreeMutation: CreateWorktreeMutation
}

// ---------------------------------------------------------------------------
// Pre-send routing — handle plan follow-up, slash commands, empty sends
// ---------------------------------------------------------------------------

interface PreSendContext {
  trimmed: string
  sendableTerminalContexts: TerminalContextDraft[]
  expiredTerminalContextCount: number
  hasSendableContent: boolean
}

function clearComposerAfterShortcut(input: SendActionInput): void {
  if (!input.activeThread) return
  input.promptRef.current = ''
  input.clearComposerDraftContent(input.activeThread.id)
  input.setComposerHighlightedItemId(null)
  input.setComposerCursor(0)
  input.setComposerTrigger(null)
}

async function tryHandlePlanFollowUp(
  input: SendActionInput,
  ctx: PreSendContext
): Promise<boolean> {
  if (!input.showPlanFollowUpPrompt || !input.activeProposedPlan) return false
  const followUp = resolvePlanFollowUpSubmission({
    draftText: ctx.trimmed,
    planMarkdown: input.activeProposedPlan.planMarkdown,
  })
  clearComposerAfterShortcut(input)
  await input.onSubmitPlanFollowUp({
    text: followUp.text,
    interactionMode: followUp.interactionMode,
  })
  return true
}

function tryHandleStandaloneSlashCommand(input: SendActionInput, ctx: PreSendContext): boolean {
  const hasImages = input.composerImages.length > 0
  const hasContexts = ctx.sendableTerminalContexts.length > 0
  const cmd = !hasImages && !hasContexts ? parseStandaloneComposerSlashCommand(ctx.trimmed) : null
  if (!cmd) return false
  input.handleInteractionModeChange(cmd)
  clearComposerAfterShortcut(input)
  return true
}

function handleEmptyContentIfNeeded(ctx: PreSendContext): boolean {
  if (ctx.hasSendableContent) return false
  if (ctx.expiredTerminalContextCount > 0) {
    const c = buildExpiredTerminalContextToastCopy(ctx.expiredTerminalContextCount, 'empty')
    toastManager.add({ type: 'warning', title: c.title, description: c.description })
  }
  return true
}

async function runSendFlow(input: SendActionInput): Promise<void> {
  const api = readNativeApi()
  if (
    !api ||
    !input.activeThread ||
    input.isSendBusy ||
    input.isConnecting ||
    input.sendInFlightRef.current
  )
    return
  if (input.activePendingProgress) {
    input.onAdvanceActivePendingUserInput()
    return
  }
  const promptForSend = input.promptRef.current
  const ctx = deriveComposerSendState({
    prompt: promptForSend,
    imageCount: input.composerImages.length,
    terminalContexts: input.composerTerminalContexts,
  }) as unknown as PreSendContext & { trimmedPrompt: string }
  const preCtx: PreSendContext = {
    trimmed: ctx.trimmedPrompt,
    sendableTerminalContexts: ctx.sendableTerminalContexts,
    expiredTerminalContextCount: ctx.expiredTerminalContextCount,
    hasSendableContent: ctx.hasSendableContent,
  }
  if (await tryHandlePlanFollowUp(input, preCtx)) return
  if (tryHandleStandaloneSlashCommand(input, preCtx)) return
  if (handleEmptyContentIfNeeded(preCtx)) return
  if (!input.activeProject) return
  await executeSend({
    api,
    activeThread: input.activeThread,
    activeProject: input.activeProject,
    isServerThread: input.isServerThread,
    isLocalDraftThread: input.isLocalDraftThread,
    envMode: input.envMode,
    composerImages: input.composerImages,
    composerTerminalContexts: preCtx.sendableTerminalContexts,
    promptForSend,
    trimmed: preCtx.trimmed,
    selectedProvider: input.selectedProvider,
    selectedModel: input.selectedModel,
    selectedProviderModels: input.selectedProviderModels,
    selectedPromptEffort: input.selectedPromptEffort,
    selectedModelSelection: input.selectedModelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    expiredTerminalContextCount: preCtx.expiredTerminalContextCount,
    sendInFlightRef: input.sendInFlightRef,
    shouldAutoScrollRef: input.shouldAutoScrollRef,
    composerImagesRef: input.composerImagesRef,
    composerTerminalContextsRef: input.composerTerminalContextsRef,
    promptRef: input.promptRef,
    beginLocalDispatch: input.beginLocalDispatch,
    resetLocalDispatch: input.resetLocalDispatch,
    setStoreThreadError: input.setStoreThreadError,
    setStoreThreadBranch: input.setStoreThreadBranch,
    setThreadError: input.setThreadError,
    setOptimisticUserMessages: input.setOptimisticUserMessages,
    setComposerCursor: input.setComposerCursor,
    setComposerTrigger: input.setComposerTrigger,
    setComposerHighlightedItemId: input.setComposerHighlightedItemId,
    forceStickToBottom: input.forceStickToBottom,
    clearComposerDraftContent: input.clearComposerDraftContent,
    addComposerImagesToDraft: input.addComposerImagesToDraft,
    addComposerTerminalContextsToDraft: input.addComposerTerminalContextsToDraft,
    setPrompt: input.setPrompt,
    persistThreadSettingsForNextTurn: input.persistThreadSettingsForNextTurn,
    runProjectScript: input.runProjectScript,
    createWorktreeMutation: input.createWorktreeMutation,
  })
}

export function useChatSendAction(input: SendActionInput) {
  return useCallback(
    async (e?: { preventDefault: () => void }) => {
      e?.preventDefault()
      await runSendFlow(input)
    },
    [input]
  )
}
