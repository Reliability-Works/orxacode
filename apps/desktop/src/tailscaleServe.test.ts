import { describe, expect, it, vi } from 'vitest'

import { resolveTailscaleServeHostname } from './tailscaleServe'

type ExecFileStub = (
  file: string,
  args: readonly string[],
  options: {
    readonly encoding: 'utf-8'
    readonly stdio: readonly ['ignore', 'pipe', 'ignore']
  }
) => string

const activeServeStatusJson = JSON.stringify({
  Web: {
    'remote-host.example.ts.net:443': {
      Handlers: {
        '/': {
          Proxy: 'http://127.0.0.1:3773',
        },
      },
    },
  },
})

const staleServeStatusJson = JSON.stringify({
  Web: {
    'remote-host.example.ts.net:443': {
      Handlers: {
        '/': {
          Proxy: 'http://127.0.0.1:59611',
        },
      },
    },
  },
})

describe('resolveTailscaleServeHostname', () => {
  it('returns the tailscale serve hostname when it proxies to the current backend port', () => {
    const execFile: ExecFileStub = vi.fn(() => activeServeStatusJson)

    expect(resolveTailscaleServeHostname({ backendPort: 3773, execFile })).toBe(
      'remote-host.example.ts.net'
    )
  })

  it('ignores stale serve entries targeting a different backend port', () => {
    const execFile: ExecFileStub = vi.fn(() => staleServeStatusJson)

    expect(resolveTailscaleServeHostname({ backendPort: 3773, execFile })).toBeNull()
  })

  it('falls back to a direct tailscale binary path when PATH lookup fails', () => {
    const execFile: ExecFileStub = vi.fn((file => {
      if (file === 'tailscale') {
        throw new Error('command not found')
      }

      if (file === '/usr/local/bin/tailscale') {
        return activeServeStatusJson
      }

      throw new Error(`unexpected binary ${file}`)
    }) as ExecFileStub)

    expect(
      resolveTailscaleServeHostname({
        backendPort: 3773,
        execFile,
        exists: path => path === '/usr/local/bin/tailscale',
      })
    ).toBe('remote-host.example.ts.net')
  })

  it('returns null when tailscale is unavailable or the output is invalid', () => {
    expect(
      resolveTailscaleServeHostname({
        backendPort: 3773,
        execFile: vi.fn((() => {
          throw new Error('missing tailscale')
        }) as ExecFileStub),
        exists: () => false,
      })
    ).toBeNull()

    expect(
      resolveTailscaleServeHostname({
        backendPort: 3773,
        execFile: vi.fn((() => 'not-json') as ExecFileStub),
        exists: () => false,
      })
    ).toBeNull()
  })
})
