/**
 * Cross-platform process tree termination helper.
 *
 * On Windows with `shell: true`, `child.kill()` only terminates the
 * `cmd.exe` wrapper and leaves the wrapped command running. Use
 * `taskkill /T /F` to terminate the entire process tree instead.
 */

import { spawnSync } from 'node:child_process'

export interface KillableChildProcess {
  pid?: number | undefined
  kill(signal?: NodeJS.Signals | number): boolean
}

export function killChildProcessTree(
  child: KillableChildProcess,
  signal: NodeJS.Signals = 'SIGTERM'
): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      return
    } catch {
      // Fall through to direct kill when taskkill is unavailable.
    }
  }
  child.kill(signal)
}
