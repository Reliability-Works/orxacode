import { createServer } from 'node:net'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const DEFAULT_REMOTE_DEBUGGING_PORTS = [9222, 9223, 9224, 9225, 9226]
const SHELL_PATH_REFRESH_TIMEOUT_MS = 4_000

function uniquePathEntries(entries: string[]) {
  const seen = new Set<string>()
  const next: string[] = []
  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    next.push(trimmed)
  }
  return next
}

function getShellPathCachePath(homeDir = homedir()) {
  return path.join(homeDir, '.orxacode', 'shell-path.txt')
}

export function buildStartupPath(
  currentPath: string | undefined,
  cachedPath?: string | null,
  homeDir = homedir()
) {
  const commonEntries = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(homeDir, '.nvm', 'versions', 'node', 'current', 'bin'),
    path.join(homeDir, '.volta', 'bin'),
    path.join(homeDir, '.local', 'share', 'mise', 'shims'),
    path.join(homeDir, '.asdf', 'shims'),
  ]
  const entries = [
    ...(cachedPath?.split(':') ?? []),
    ...(currentPath?.split(':') ?? []),
    ...commonEntries,
  ]
  return uniquePathEntries(entries).join(':')
}

export function applyStartupPathBootstrap(
  env: NodeJS.ProcessEnv,
  options?: { homeDir?: string }
) {
  const homeDir = options?.homeDir ?? homedir()
  let cachedPath: string | undefined
  try {
    cachedPath = readFileSync(getShellPathCachePath(homeDir), 'utf8').trim() || undefined
  } catch {
    cachedPath = undefined
  }
  env.PATH = buildStartupPath(env.PATH, cachedPath, homeDir)
  return env.PATH
}

export async function refreshShellPathInBackground(
  env: NodeJS.ProcessEnv,
  options?: { shellPath?: string; homeDir?: string; timeoutMs?: number }
) {
  const shellPath = options?.shellPath ?? env.SHELL ?? '/bin/zsh'
  const homeDir = options?.homeDir ?? homedir()
  const timeoutMs = options?.timeoutMs ?? SHELL_PATH_REFRESH_TIMEOUT_MS

  const resolvedPath = await new Promise<string>((resolve, reject) => {
    const child = spawn(shellPath, ['-ilc', 'echo $PATH'], {
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const stdout: string[] = []
    let settled = false
    const finish = (value: string | Error) => {
      if (settled) {
        return
      }
      settled = true
      if (value instanceof Error) {
        reject(value)
        return
      }
      resolve(value)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish(new Error(`Shell PATH refresh timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout?.on('data', chunk => {
      stdout.push(String(chunk))
    })
    child.on('error', error => {
      clearTimeout(timer)
      finish(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) {
        finish(new Error(`Shell PATH refresh exited with code ${code ?? 'unknown'}`))
        return
      }
      finish(stdout.join('').trim())
    })
  })

  const nextPath = buildStartupPath(env.PATH, resolvedPath, homeDir)
  env.PATH = nextPath

  const cachePath = getShellPathCachePath(homeDir)
  mkdirSync(path.dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, resolvedPath, 'utf8')
  return nextPath
}

async function canListenOnPort(host: string, port: number) {
  return await new Promise<boolean>(resolve => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

export async function pickRemoteDebuggingPort(
  preferredPorts = DEFAULT_REMOTE_DEBUGGING_PORTS,
  host = '127.0.0.1'
) {
  for (const port of preferredPorts) {
    if (await canListenOnPort(host, port)) {
      return port
    }
  }
  return preferredPorts[0] ?? 9222
}
