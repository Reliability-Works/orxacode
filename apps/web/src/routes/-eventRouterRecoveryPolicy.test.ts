import { describe, expect, it } from 'vitest'

import { resolveConnectionReconcileAction } from './-eventRouterRecoveryPolicy'

describe('resolveConnectionReconcileAction', () => {
  it('skips reconnect attempts while recovery is already in flight', () => {
    expect(
      resolveConnectionReconcileAction({
        bootstrapped: false,
        inFlight: { kind: 'snapshot', reason: 'foreground-reconcile' },
      })
    ).toBe('skip')
  })

  it('skips foreground reconcile before the runtime has bootstrapped', () => {
    expect(
      resolveConnectionReconcileAction({
        bootstrapped: false,
        inFlight: null,
      })
    ).toBe('skip')
  })

  it('reconciles without reconnect after bootstrap is complete when no recovery is active', () => {
    expect(
      resolveConnectionReconcileAction({
        bootstrapped: true,
        inFlight: null,
      })
    ).toBe('reconcile-only')
  })
})
