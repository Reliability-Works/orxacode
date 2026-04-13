import type { resolveInitialPrimaryAuthGateState } from '../environments/primary'

export type RootRuntimeBootStrategy = 'pair' | 'primary'

export function resolveRootRuntimeBootStrategy(input: {
  readonly authStatus: Awaited<ReturnType<typeof resolveInitialPrimaryAuthGateState>>['status']
  readonly hasDesktopManagedPrimary: boolean
  readonly hasPairingToken: boolean
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
  return 'pair'
}
