/**
 * Cross-platform process tree termination helper.
 *
 * On Windows with `shell: true`, `child.kill()` only terminates the
 * `cmd.exe` wrapper and leaves the wrapped command running. Use
 * `taskkill /T /F` to terminate the entire process tree instead.
 *
 * On Unix, `child.kill()` only signals the immediate child PID. If the
 * child has spawned descendants of its own (workers, plugins, etc.) and
 * we force-kill the parent, those grandchildren survive and reparent to
 * init/launchd. Pass `{ viaProcessGroup: true }` to signal the entire
 * process group via `process.kill(-pid, signal)`. This requires the
 * child to have been spawned with `detached: true` so it is a process
 * group leader (its PGID equals its PID).
 */

import { spawnSync } from 'node:child_process'

export interface KillableChildProcess {
  pid?: number | undefined
  kill(signal?: NodeJS.Signals | number): boolean
}

export interface KillChildProcessTreeOptions {
  readonly viaProcessGroup?: boolean
}

export function killChildProcessTree(
  child: KillableChildProcess,
  signal: NodeJS.Signals = 'SIGTERM',
  options: KillChildProcessTreeOptions = {}
): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      return
    } catch {
      // Fall through to direct kill when taskkill is unavailable.
    }
  }
  if (options.viaProcessGroup && child.pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // ESRCH (group already gone) or EPERM — fall through to single-pid kill.
    }
  }
  child.kill(signal)
}
