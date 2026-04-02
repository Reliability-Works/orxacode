import { describe, expect, it } from 'vitest'
import { toDebugLogFromEvent } from './app-core-debug'

describe('toDebugLogFromEvent', () => {
  it('serializes app command events for diagnostics logs', () => {
    const commands = [
      'open-settings',
      'toggle-workspace-sidebar',
      'toggle-operations-sidebar',
      'toggle-browser-sidebar',
    ] as const

    for (const command of commands) {
      const entry = toDebugLogFromEvent({
        type: 'app.command',
        payload: { command },
      })

      expect(entry.level).toBe('info')
      expect(entry.eventType).toBe('app.command')
      expect(entry.summary).toBe('app.command')
      expect(entry.details).toContain(command)
    }
  })
})
