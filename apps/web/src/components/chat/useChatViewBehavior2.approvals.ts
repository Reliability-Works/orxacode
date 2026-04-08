/**
 * Approval + pending user input callbacks extracted from useChatViewBehavior2.
 *
 * Keeps the aggregator within max-lines per function/file.
 */

import { useCallback } from 'react'
import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ThreadId,
} from '@orxa-code/contracts'
import { newCommandId } from '~/lib/utils'
import { readNativeApi } from '~/nativeApi'
import { detectComposerTrigger } from '../../composer-logic'
import { setPendingUserInputCustomAnswer } from '../../pendingUserInput'
import type { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import type { useChatViewLocalState } from './useChatViewLocalState'
import type { useChatViewDerivedActivities } from './useChatViewDerivedActivities'

type S = ReturnType<typeof useChatViewStoreSelectors>
type L = ReturnType<typeof useChatViewLocalState>
type A = ReturnType<typeof useChatViewDerivedActivities>

export function useApprovalCallbacks(activeThreadId: ThreadId | null, store: S, ls: L) {
  const { setStoreThreadError } = store
  const { setRespondingRequestIds, setRespondingUserInputRequestIds } = ls

  const onRespondToApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      const api = readNativeApi()
      if (!api || !activeThreadId) return
      setRespondingRequestIds(ex => (ex.includes(requestId) ? ex : [...ex, requestId]))
      await api.orchestration
        .dispatchCommand({
          type: 'thread.approval.respond',
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          decision,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setStoreThreadError(
            activeThreadId,
            err instanceof Error ? err.message : 'Failed to submit approval decision.'
          )
        })
      setRespondingRequestIds(ex => ex.filter(id => id !== requestId))
    },
    [activeThreadId, setStoreThreadError, setRespondingRequestIds]
  )

  const onRespondToUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: Record<string, unknown>) => {
      const api = readNativeApi()
      if (!api || !activeThreadId) return
      setRespondingUserInputRequestIds(ex => (ex.includes(requestId) ? ex : [...ex, requestId]))
      await api.orchestration
        .dispatchCommand({
          type: 'thread.user-input.respond',
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          answers,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setStoreThreadError(
            activeThreadId,
            err instanceof Error ? err.message : 'Failed to submit user input.'
          )
        })
      setRespondingUserInputRequestIds(ex => ex.filter(id => id !== requestId))
    },
    [activeThreadId, setStoreThreadError, setRespondingUserInputRequestIds]
  )

  return { onRespondToApproval, onRespondToUserInput }
}

function usePendingUserInputAnswerCallbacks(
  ls: L,
  activePendingUserInput: A['activePendingUserInput']
) {
  const {
    setPendingUserInputAnswersByRequestId,
    promptRef,
    setComposerCursor,
    setComposerTrigger,
  } = ls

  const onSelectActivePendingUserInputOption = useCallback(
    (questionId: string, optionLabel: string) => {
      if (!activePendingUserInput) return
      setPendingUserInputAnswersByRequestId(ex => ({
        ...ex,
        [activePendingUserInput.requestId]: {
          ...ex[activePendingUserInput.requestId],
          [questionId]: { selectedOptionLabel: optionLabel, customAnswer: '' },
        },
      }))
      promptRef.current = ''
      setComposerCursor(0)
      setComposerTrigger(null)
    },
    [
      activePendingUserInput,
      promptRef,
      setComposerCursor,
      setComposerTrigger,
      setPendingUserInputAnswersByRequestId,
    ]
  )

  const onChangeActivePendingUserInputCustomAnswer = useCallback(
    (
      questionId: string,
      value: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean
    ) => {
      if (!activePendingUserInput) return
      promptRef.current = value
      setPendingUserInputAnswersByRequestId(ex => ({
        ...ex,
        [activePendingUserInput.requestId]: {
          ...ex[activePendingUserInput.requestId],
          [questionId]: setPendingUserInputCustomAnswer(
            ex[activePendingUserInput.requestId]?.[questionId],
            value
          ),
        },
      }))
      setComposerCursor(nextCursor)
      setComposerTrigger(
        cursorAdjacentToMention ? null : detectComposerTrigger(value, expandedCursor)
      )
    },
    [
      activePendingUserInput,
      promptRef,
      setComposerCursor,
      setComposerTrigger,
      setPendingUserInputAnswersByRequestId,
    ]
  )

  return { onSelectActivePendingUserInputOption, onChangeActivePendingUserInputCustomAnswer }
}

export function usePendingUserInputCallbacks(
  ls: L,
  ad: A,
  onRespondToUserInput: (
    requestId: ApprovalRequestId,
    answers: Record<string, unknown>
  ) => Promise<void>
) {
  const { setPendingUserInputQuestionIndexByRequestId } = ls
  const { activePendingUserInput, activePendingProgress, activePendingResolvedAnswers } = ad

  const setActivePendingUserInputQuestionIndex = useCallback(
    (nextIdx: number) => {
      if (!activePendingUserInput) return
      setPendingUserInputQuestionIndexByRequestId(ex => ({
        ...ex,
        [activePendingUserInput.requestId]: nextIdx,
      }))
    },
    [activePendingUserInput, setPendingUserInputQuestionIndexByRequestId]
  )

  const answerCallbacks = usePendingUserInputAnswerCallbacks(ls, activePendingUserInput)

  const onAdvanceActivePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || !activePendingProgress) return
    if (activePendingProgress.isLastQuestion) {
      if (activePendingResolvedAnswers)
        void onRespondToUserInput(activePendingUserInput.requestId, activePendingResolvedAnswers)
      return
    }
    setActivePendingUserInputQuestionIndex(activePendingProgress.questionIndex + 1)
  }, [
    activePendingUserInput,
    activePendingProgress,
    activePendingResolvedAnswers,
    onRespondToUserInput,
    setActivePendingUserInputQuestionIndex,
  ])

  const onPreviousActivePendingUserInputQuestion = useCallback(() => {
    if (!activePendingProgress) return
    setActivePendingUserInputQuestionIndex(Math.max(activePendingProgress.questionIndex - 1, 0))
  }, [activePendingProgress, setActivePendingUserInputQuestionIndex])

  return {
    setActivePendingUserInputQuestionIndex,
    ...answerCallbacks,
    onAdvanceActivePendingUserInput,
    onPreviousActivePendingUserInputQuestion,
  }
}
