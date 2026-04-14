import type { OrchestrationRecoveryState } from '../orchestrationRecovery'

export type ConnectionReconcileAction = 'skip' | 'reconcile-only'

export function resolveConnectionReconcileAction(
  state: Pick<OrchestrationRecoveryState, 'bootstrapped' | 'inFlight'>
): ConnectionReconcileAction {
  if (state.inFlight !== null) {
    return 'skip'
  }
  if (!state.bootstrapped) {
    return 'skip'
  }
  return 'reconcile-only'
}
