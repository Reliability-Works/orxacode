/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest'
import { createStartupBootstrapTracker } from './startup-bootstrap'

describe('createStartupBootstrapTracker', () => {
  it('deduplicates concurrent startup tasks', async () => {
    const tracker = createStartupBootstrapTracker()
    let resolveTask: (() => void) | undefined
    const task = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveTask = resolve
        })
    )

    const first = tracker.start(task)
    const second = tracker.start(task)

    expect(first).toBe(second)
    expect(task).toHaveBeenCalledTimes(1)
    expect(tracker.hasPending()).toBe(true)

    resolveTask?.()
    await first

    expect(tracker.hasPending()).toBe(false)
  })

  it('wait resolves immediately when no startup is pending', async () => {
    const tracker = createStartupBootstrapTracker()
    await expect(tracker.wait()).resolves.toBeUndefined()
  })

  it('supports clearing pending state during mode switch', async () => {
    const tracker = createStartupBootstrapTracker()

    void tracker.start(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 100))
    })

    expect(tracker.hasPending()).toBe(true)
    tracker.clear()
    expect(tracker.hasPending()).toBe(false)
  })
})
