import type { resolveInitialPrimaryAuthGateState } from '../environments/primary'

export type RootRuntimeBootStrategy = 'pair' | 'primary' | 'saved-remote'

export function resolveRootRuntimeBootStrategy(input: {
  readonly authStatus: Awaited<ReturnType<typeof resolveInitialPrimaryAuthGateState>>['status']
  readonly hasDesktopManagedPrimary: boolean
  readonly hasPairingToken: boolean
  readonly hasSavedRemote: boolean
}): RootRuntimeBootStrategy {
  if (input.hasPairingToken) {
    return 'pair'
  }
  if (input.hasDesktopManagedPrimary) {
    return 'primary'
  }
  if (input.authStatus === 'authenticated') {
    return 'primary'
  }
  if (input.hasSavedRemote) {
    return 'saved-remote'
  }
  return 'pair'
}
