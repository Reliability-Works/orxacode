import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

interface TailscaleServeStatusJson {
  readonly Web?: Record<
    string,
    {
      readonly Handlers?: Record<
        string,
        {
          readonly Proxy?: string
        }
      >
    }
  >
}

type ExecFileSyncLike = (
  file: string,
  args: readonly string[],
  options: {
    readonly encoding: 'utf-8'
    readonly stdio: readonly ['ignore', 'pipe', 'ignore']
  }
) => string

type ExistsSyncLike = (path: string) => boolean

const TAILSCALE_BINARY_CANDIDATES = [
  'tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
] as const

function normalizeHostname(value: string): string {
  return value.trim().replace(/\.$/, '')
}

function normalizeProxyTarget(value: string): string {
  return value.trim().replace(/\/$/, '')
}

export function resolveTailscaleServeHostname(input: {
  backendPort: number
  execFile?: ExecFileSyncLike
  exists?: ExistsSyncLike
}): string | null {
  const execFile = (input.execFile ?? execFileSync) as ExecFileSyncLike
  const pathExists = input.exists ?? existsSync
  let rawOutput = ''

  for (const binaryPath of TAILSCALE_BINARY_CANDIDATES) {
    if (binaryPath !== 'tailscale' && !pathExists(binaryPath)) {
      continue
    }

    try {
      rawOutput = execFile(binaryPath, ['serve', 'status', '--json'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      break
    } catch {
      rawOutput = ''
    }
  }

  if (!rawOutput) {
    return null
  }

  let parsed: TailscaleServeStatusJson
  try {
    parsed = JSON.parse(rawOutput) as TailscaleServeStatusJson
  } catch {
    return null
  }

  const expectedProxyTargets = new Set([
    `http://127.0.0.1:${input.backendPort}`,
    `http://localhost:${input.backendPort}`,
  ])

  for (const [webEntryHost, webEntry] of Object.entries(parsed.Web ?? {})) {
    for (const handler of Object.values(webEntry.Handlers ?? {})) {
      const proxyTarget = handler.Proxy ? normalizeProxyTarget(handler.Proxy) : null
      if (!proxyTarget || !expectedProxyTargets.has(proxyTarget)) {
        continue
      }

      const [hostname] = webEntryHost.split(':')
      if (hostname && hostname.endsWith('.ts.net')) {
        return normalizeHostname(hostname)
      }
    }
  }

  return null
}
