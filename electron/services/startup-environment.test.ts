/** @vitest-environment node */

import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { buildStartupPath, pickRemoteDebuggingPort } from './startup-environment'

describe('buildStartupPath', () => {
  it('deduplicates entries while preserving cached and current paths', () => {
    const result = buildStartupPath(
      '/usr/bin:/opt/homebrew/bin',
      '/custom/bin:/usr/bin',
      '/Users/test'
    )

    expect(result.split(':').slice(0, 4)).toEqual([
      '/custom/bin',
      '/usr/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ])
  })
})

describe('pickRemoteDebuggingPort', () => {
  it('skips occupied ports in the preferred range', async () => {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const occupiedPort = (server.address() as { port: number }).port

    try {
      const selected = await pickRemoteDebuggingPort([occupiedPort, occupiedPort + 1], '127.0.0.1')
      expect(selected).toBe(occupiedPort + 1)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
      })
    }
  })
})
