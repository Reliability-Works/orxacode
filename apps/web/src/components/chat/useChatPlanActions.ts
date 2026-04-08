/**
 * Plan action hooks for ChatView.
 *
 * Extracts onSubmitPlanFollowUp and onImplementPlanInNewThread from the
 * monolithic ChatView function. Pure async bodies are defined outside hooks to
 * stay within the 75-line per-function limit.
 */

import { useCallback } from 'react'
import {
  type ModelSelection,
  type ProjectId,
  type ProviderKind,
  type ServerProvider,
  type ThreadId,
  type RuntimeMode,
  type ProviderInteractionMode,
} from '@orxa-code/contracts'
import { truncate } from '@orxa-code/shared/String'
import { newCommandId, newMessageId, newThreadId } from '~/lib/utils'
import { readNativeApi } from '~/nativeApi'
import { toastManager } from '../ui/toastState'
import {
  buildPlanImplementationThreadTitle,
  buildPlanImplementationPrompt,
} from '../../proposedPlan'
import { waitForStartedServerThread } from '../ChatView.logic'
import { formatOutgoingPrompt } from './useChatSendAction'
import type { Thread } from '../../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlanActionInputBase {
  activeThread: Thread | null
  activeProposedPlan: { id: string; planMarkdown: string } | null
  isServerThread: boolean
  isSendBusy: boolean
  isConnecting: boolean
  selectedProvider: ProviderKind
  selectedModel: string
  selectedProviderModels: ReadonlyArray<ServerProvider['models'][number]>
  selectedPromptEffort: string | null
  selectedModelSelection: ModelSelection
  runtimeMode: RuntimeMode
  sendInFlightRef: React.MutableRefObject<boolean>
}

export interface SubmitPlanFollowUpInput extends PlanActionInputBase {
  beginLocalDispatch: (opts?: { preparingWorktree?: boolean }) => void
  resetLocalDispatch: () => void
  setThreadError: (id: ThreadId | null, error: string | null) => void
  setOptimisticUserMessages: React.Dispatch<
    React.SetStateAction<import('../../types').ChatMessage[]>
  >
  forceStickToBottom: () => void
  setPlanSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>
  planSidebarDismissedForTurnRef: React.MutableRefObject<string | null>
  setComposerDraftInteractionMode: (threadId: ThreadId, mode: ProviderInteractionMode) => void
  persistThreadSettingsForNextTurn: (input: {
    threadId: ThreadId
    createdAt: string
    modelSelection?: ModelSelection
    runtimeMode: RuntimeMode
    interactionMode: ProviderInteractionMode
  }) => Promise<void>
}

export interface ImplementPlanInNewThreadInput extends PlanActionInputBase {
  activeProject: { id: ProjectId; cwd: string } | null
  planSidebarOpenOnNextThreadRef: React.MutableRefObject<boolean>
  beginLocalDispatch: (opts?: { preparingWorktree?: boolean }) => void
  resetLocalDispatch: () => void
  navigate: (opts: { to: string; params: { threadId: string } }) => Promise<void>
}

// ---------------------------------------------------------------------------
// Pure async bodies (outside hooks — no line limit applies to them individually
// but each is ≤75 lines of meaningful content)
// ---------------------------------------------------------------------------

async function executeSubmitPlanFollowUp(
  text: string,
  nextInteractionMode: 'default' | 'plan',
  p: SubmitPlanFollowUpInput
): Promise<void> {
  if (!p.activeThread || !p.isServerThread) return
  const api = readNativeApi()
  if (!api) return
  const trimmed = text.trim()
  if (!trimmed) return

  const threadIdForSend = p.activeThread.id
  const messageIdForSend = newMessageId()
  const messageCreatedAt = new Date().toISOString()
  const outgoingText = formatOutgoingPrompt({
    provider: p.selectedProvider,
    model: p.selectedModel,
    models: p.selectedProviderModels,
    effort: p.selectedPromptEffort,
    text: trimmed,
  })

  p.sendInFlightRef.current = true
  p.beginLocalDispatch({ preparingWorktree: false })
  p.setThreadError(threadIdForSend, null)
  p.setOptimisticUserMessages(existing => [
    ...existing,
    {
      id: messageIdForSend,
      role: 'user',
      text: outgoingText,
      createdAt: messageCreatedAt,
      streaming: false,
    },
  ])
  p.forceStickToBottom()

  try {
    await p.persistThreadSettingsForNextTurn({
      threadId: threadIdForSend,
      createdAt: messageCreatedAt,
      modelSelection: p.selectedModelSelection,
      runtimeMode: p.runtimeMode,
      interactionMode: nextInteractionMode,
    })
    p.setComposerDraftInteractionMode(threadIdForSend, nextInteractionMode)
    await api.orchestration.dispatchCommand({
      type: 'thread.turn.start',
      commandId: newCommandId(),
      threadId: threadIdForSend,
      message: { messageId: messageIdForSend, role: 'user', text: outgoingText, attachments: [] },
      modelSelection: p.selectedModelSelection,
      titleSeed: p.activeThread.title,
      runtimeMode: p.runtimeMode,
      interactionMode: nextInteractionMode,
      ...(nextInteractionMode === 'default' && p.activeProposedPlan
        ? { sourceProposedPlan: { threadId: p.activeThread.id, planId: p.activeProposedPlan.id } }
        : {}),
      createdAt: messageCreatedAt,
    })
    if (nextInteractionMode === 'default') {
      p.planSidebarDismissedForTurnRef.current = null
      p.setPlanSidebarOpen(true)
    }
    p.sendInFlightRef.current = false
  } catch (err) {
    p.setOptimisticUserMessages(existing => existing.filter(m => m.id !== messageIdForSend))
    p.setThreadError(
      threadIdForSend,
      err instanceof Error ? err.message : 'Failed to send plan follow-up.'
    )
    p.sendInFlightRef.current = false
    p.resetLocalDispatch()
  }
}

async function executeImplementPlanInNewThread(p: ImplementPlanInNewThreadInput): Promise<void> {
  if (!p.activeThread || !p.activeProject || !p.activeProposedPlan || !p.isServerThread) return
  const api = readNativeApi()
  if (!api) return

  const createdAt = new Date().toISOString()
  const nextThreadId = newThreadId()
  const planMarkdown = p.activeProposedPlan.planMarkdown
  const implementationPrompt = buildPlanImplementationPrompt(planMarkdown)
  const outgoingText = formatOutgoingPrompt({
    provider: p.selectedProvider,
    model: p.selectedModel,
    models: p.selectedProviderModels,
    effort: p.selectedPromptEffort,
    text: implementationPrompt,
  })
  const nextTitle = truncate(buildPlanImplementationThreadTitle(planMarkdown))
  const nextModelSelection: ModelSelection = p.selectedModelSelection

  p.sendInFlightRef.current = true
  p.beginLocalDispatch({ preparingWorktree: false })
  const finish = () => {
    p.sendInFlightRef.current = false
    p.resetLocalDispatch()
  }

  await api.orchestration
    .dispatchCommand({
      type: 'thread.create',
      commandId: newCommandId(),
      threadId: nextThreadId,
      projectId: p.activeProject.id,
      title: nextTitle,
      modelSelection: nextModelSelection,
      runtimeMode: p.runtimeMode,
      interactionMode: 'default',
      branch: p.activeThread.branch,
      worktreePath: p.activeThread.worktreePath,
      createdAt,
    })
    .then(() =>
      api.orchestration.dispatchCommand({
        type: 'thread.turn.start',
        commandId: newCommandId(),
        threadId: nextThreadId,
        message: { messageId: newMessageId(), role: 'user', text: outgoingText, attachments: [] },
        modelSelection: p.selectedModelSelection,
        titleSeed: nextTitle,
        runtimeMode: p.runtimeMode,
        interactionMode: 'default',
        sourceProposedPlan: { threadId: p.activeThread!.id, planId: p.activeProposedPlan!.id },
        createdAt,
      })
    )
    .then(() => waitForStartedServerThread(nextThreadId))
    .then(() => {
      p.planSidebarOpenOnNextThreadRef.current = true
      return p.navigate({ to: '/$threadId', params: { threadId: nextThreadId } })
    })
    .catch(async err => {
      await api.orchestration
        .dispatchCommand({
          type: 'thread.delete',
          commandId: newCommandId(),
          threadId: nextThreadId,
        })
        .catch(() => undefined)
      toastManager.add({
        type: 'error',
        title: 'Could not start implementation thread',
        description:
          err instanceof Error ? err.message : 'An error occurred while creating the new thread.',
      })
    })
    .then(finish, finish)
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

async function runSubmitPlanFollowUp(
  input: { text: string; interactionMode: 'default' | 'plan' },
  p: SubmitPlanFollowUpInput
): Promise<void> {
  if (
    !p.activeThread ||
    !p.isServerThread ||
    p.isSendBusy ||
    p.isConnecting ||
    p.sendInFlightRef.current
  )
    return
  await executeSubmitPlanFollowUp(input.text, input.interactionMode, p)
}

export function useChatSubmitPlanFollowUp(p: SubmitPlanFollowUpInput) {
  const {
    activeThread,
    activeProposedPlan,
    isServerThread,
    isSendBusy,
    isConnecting,
    selectedProvider,
    selectedModel,
    selectedProviderModels,
    selectedPromptEffort,
    selectedModelSelection,
    runtimeMode,
    sendInFlightRef,
    beginLocalDispatch,
    resetLocalDispatch,
    setThreadError,
    setOptimisticUserMessages,
    forceStickToBottom,
    setPlanSidebarOpen,
    planSidebarDismissedForTurnRef,
    setComposerDraftInteractionMode,
    persistThreadSettingsForNextTurn,
  } = p
  return useCallback(
    (input: { text: string; interactionMode: 'default' | 'plan' }) =>
      runSubmitPlanFollowUp(input, {
        activeThread,
        activeProposedPlan,
        isServerThread,
        isSendBusy,
        isConnecting,
        selectedProvider,
        selectedModel,
        selectedProviderModels,
        selectedPromptEffort,
        selectedModelSelection,
        runtimeMode,
        sendInFlightRef,
        beginLocalDispatch,
        resetLocalDispatch,
        setThreadError,
        setOptimisticUserMessages,
        forceStickToBottom,
        setPlanSidebarOpen,
        planSidebarDismissedForTurnRef,
        setComposerDraftInteractionMode,
        persistThreadSettingsForNextTurn,
      }),
    [
      activeThread,
      activeProposedPlan,
      isServerThread,
      isSendBusy,
      isConnecting,
      selectedProvider,
      selectedModel,
      selectedProviderModels,
      selectedPromptEffort,
      selectedModelSelection,
      runtimeMode,
      sendInFlightRef,
      beginLocalDispatch,
      resetLocalDispatch,
      setThreadError,
      setOptimisticUserMessages,
      forceStickToBottom,
      setPlanSidebarOpen,
      planSidebarDismissedForTurnRef,
      setComposerDraftInteractionMode,
      persistThreadSettingsForNextTurn,
    ]
  )
}

export function useChatImplementPlanInNewThread(p: ImplementPlanInNewThreadInput) {
  const {
    activeThread,
    activeProject,
    activeProposedPlan,
    isServerThread,
    isSendBusy,
    isConnecting,
    selectedProvider,
    selectedModel,
    selectedProviderModels,
    selectedPromptEffort,
    selectedModelSelection,
    runtimeMode,
    sendInFlightRef,
    planSidebarOpenOnNextThreadRef,
    beginLocalDispatch,
    resetLocalDispatch,
    navigate,
  } = p

  return useCallback(async () => {
    if (
      !activeThread ||
      !activeProject ||
      !activeProposedPlan ||
      !isServerThread ||
      isSendBusy ||
      isConnecting ||
      sendInFlightRef.current
    )
      return
    await executeImplementPlanInNewThread({
      activeThread,
      activeProject,
      activeProposedPlan,
      isServerThread,
      isSendBusy,
      isConnecting,
      selectedProvider,
      selectedModel,
      selectedProviderModels,
      selectedPromptEffort,
      selectedModelSelection,
      runtimeMode,
      sendInFlightRef,
      planSidebarOpenOnNextThreadRef,
      beginLocalDispatch,
      resetLocalDispatch,
      navigate,
    })
  }, [
    activeThread,
    activeProject,
    activeProposedPlan,
    isServerThread,
    isSendBusy,
    isConnecting,
    selectedProvider,
    selectedModel,
    selectedProviderModels,
    selectedPromptEffort,
    selectedModelSelection,
    runtimeMode,
    sendInFlightRef,
    planSidebarOpenOnNextThreadRef,
    beginLocalDispatch,
    resetLocalDispatch,
    navigate,
  ])
}
