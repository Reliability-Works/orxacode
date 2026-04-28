/**
 * Boot-time reaper for orphaned `opencode serve` subprocesses.
 *
 * The discovery probe path spawns short-lived `opencode serve` subprocesses
 * that should exit when their shutdown handler fires. If the parent process
 * crashed, was force-killed, or the child ignored SIGTERM, those servers
 * survive and reparent to launchd / init (PPID 1). They accumulate over
 * time — historically one every 5 minutes per cache miss.
 *
 * This module finds those orphans on startup (PPID === 1 + matching argv)
 * and kills them so a fresh app launch starts from a clean slate.
 *
 * Unix-only. On Windows, parsing PPIDs requires `wmic` / PowerShell which
 * is heavier than warranted for the failure modes we have actually seen.
 */
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

const REAPER_TIMEOUT_MS = 5_000

interface OrphanCandidate {
  readonly pid: number
  readonly command: string
}

export function parsePsLine(line: string): { pid: number; ppid: number; command: string } | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/)
  if (!match) return null
  const pid = Number(match[1])
  const ppid = Number(match[2])
  const command = match[3] ?? ''
  if (!Number.isFinite(pid) || !Number.isFinite(ppid)) return null
  return { pid, ppid, command }
}

export function looksLikeOpencodeServe(command: string): boolean {
  // Match the `opencode serve --port` invocation we spawn ourselves. The
  // npm shim resolves to `.opencode` post-exec, so the visible argv may use
  // either form. We deliberately do NOT match `opencode tui` or any other
  // subcommand a user might be running from a terminal.
  if (!command.includes('serve')) return false
  if (!command.includes('--port')) return false
  return /(?:^|[\s/])\.?opencode(?:\s|$)/.test(command)
}

async function listOpencodeOrphans(currentPid: number): Promise<ReadonlyArray<OrphanCandidate>> {
  const { stdout } = await execAsync('ps -A -o pid=,ppid=,command=', {
    timeout: REAPER_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  })
  const orphans: Array<OrphanCandidate> = []
  for (const line of stdout.split('\n')) {
    const parsed = parsePsLine(line)
    if (parsed === null) continue
    if (parsed.pid === currentPid) continue
    if (parsed.ppid !== 1) continue
    if (!looksLikeOpencodeServe(parsed.command)) continue
    orphans.push({ pid: parsed.pid, command: parsed.command })
  }
  return orphans
}

export interface ReapOpencodeOrphansResult {
  readonly killed: ReadonlyArray<number>
  readonly skipped: boolean
}

/**
 * Find and SIGKILL any orphaned `opencode serve --port` processes whose
 * parent is init/launchd. Best-effort: errors are swallowed so a failed
 * reap never blocks startup.
 */
export async function reapOpencodeOrphans(): Promise<ReapOpencodeOrphansResult> {
  if (process.platform === 'win32') {
    return { killed: [], skipped: true }
  }
  try {
    const orphans = await listOpencodeOrphans(process.pid)
    const killed: Array<number> = []
    for (const orphan of orphans) {
      try {
        process.kill(orphan.pid, 'SIGKILL')
        killed.push(orphan.pid)
      } catch {
        // Process may have exited between listing and kill.
      }
    }
    return { killed, skipped: false }
  } catch {
    return { killed: [], skipped: false }
  }
}
