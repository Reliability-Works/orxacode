import { useCallback, useEffect, useRef, useState } from 'react'

export type AppShellCommitFlowState<NextStep extends string> = {
  phase: 'running' | 'success' | 'error'
  nextStep: NextStep
  message: string
}

type UseAppShellCommitFlowInput<NextStep extends string> = {
  runningMessage: (nextStep: NextStep) => string
  successMessage: (nextStep: NextStep) => string
}

export function useAppShellCommitFlow<NextStep extends string>(
  input: UseAppShellCommitFlowInput<NextStep>
) {
  const { runningMessage, successMessage } = input
  const [commitFlowState, setCommitFlowState] = useState<AppShellCommitFlowState<NextStep> | null>(
    null
  )
  const dismissTimerRef = useRef<number | null>(null)

  const clearCommitFlowDismissTimer = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  const dismissCommitFlowState = useCallback(() => {
    clearCommitFlowDismissTimer()
    setCommitFlowState(null)
  }, [clearCommitFlowDismissTimer])

  const scheduleCommitFlowDismiss = useCallback(
    (delayMs: number) => {
      clearCommitFlowDismissTimer()
      dismissTimerRef.current = window.setTimeout(() => {
        setCommitFlowState(null)
        dismissTimerRef.current = null
      }, delayMs)
    },
    [clearCommitFlowDismissTimer]
  )

  const startCommitFlow = useCallback(
    (nextStep: NextStep) => {
      setCommitFlowState({
        phase: 'running',
        nextStep,
        message: runningMessage(nextStep),
      })
    },
    [runningMessage]
  )

  const completeCommitFlow = useCallback(
    (nextStep: NextStep) => {
      setCommitFlowState({
        phase: 'success',
        nextStep,
        message: successMessage(nextStep),
      })
    },
    [successMessage]
  )

  const failCommitFlow = useCallback(
    (nextStep: NextStep, message: string) => {
      setCommitFlowState({
        phase: 'error',
        nextStep,
        message,
      })
      clearCommitFlowDismissTimer()
    },
    [clearCommitFlowDismissTimer]
  )

  useEffect(() => () => clearCommitFlowDismissTimer(), [clearCommitFlowDismissTimer])

  return {
    commitFlowState,
    setCommitFlowState,
    clearCommitFlowDismissTimer,
    scheduleCommitFlowDismiss,
    startCommitFlow,
    completeCommitFlow,
    failCommitFlow,
    dismissCommitFlowState,
  }
}
