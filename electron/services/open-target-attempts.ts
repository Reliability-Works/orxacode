import type { OpenDirectoryTarget } from '../../shared/ipc'

export type OpenTargetAttempt = {
  command: string
  args: string[]
  label: string
}

type BuildOpenTargetAttemptsInput = {
  platform: NodeJS.Platform
  target: OpenDirectoryTarget
  resolvedPath: string
  mode: 'directory' | 'file'
}

export function buildOpenTargetAttempts(input: BuildOpenTargetAttemptsInput): OpenTargetAttempt[] {
  const { platform, target, resolvedPath, mode } = input
  const attempts: OpenTargetAttempt[] = []

  if (platform === 'darwin') {
    if (target === 'finder') {
      attempts.push({
        command: 'open',
        args: mode === 'file' ? ['-R', resolvedPath] : [resolvedPath],
        label: 'Finder',
      })
    }
    if (target === 'cursor') {
      attempts.push({ command: 'open', args: ['-a', 'Cursor', resolvedPath], label: 'Cursor' })
      attempts.push({ command: 'cursor', args: [resolvedPath], label: 'Cursor CLI' })
    }
    if (target === 'antigravity') {
      attempts.push({
        command: 'open',
        args: ['-a', 'Antigravity', resolvedPath],
        label: 'Antigravity',
      })
    }
    if (target === 'terminal') {
      attempts.push({ command: 'open', args: ['-a', 'Terminal', resolvedPath], label: 'Terminal' })
    }
    if (target === 'ghostty') {
      attempts.push({ command: 'open', args: ['-a', 'Ghostty', resolvedPath], label: 'Ghostty' })
    }
    if (target === 'xcode') {
      attempts.push({ command: 'open', args: ['-a', 'Xcode', resolvedPath], label: 'Xcode' })
    }
    if (target === 'zed') {
      attempts.push({ command: 'open', args: ['-a', 'Zed', resolvedPath], label: 'Zed' })
      attempts.push({ command: 'zed', args: [resolvedPath], label: 'Zed CLI' })
    }
    return attempts
  }

  if (target === 'finder') {
    attempts.push({ command: 'xdg-open', args: [resolvedPath], label: 'File manager' })
  }
  if (target === 'cursor') {
    attempts.push({ command: 'cursor', args: [resolvedPath], label: 'Cursor' })
  }
  if (target === 'antigravity') {
    attempts.push({ command: 'antigravity', args: [resolvedPath], label: 'Antigravity' })
  }
  if (target === 'terminal') {
    if (mode === 'directory') {
      attempts.push({
        command: 'ghostty',
        args: ['--working-directory', resolvedPath],
        label: 'Ghostty',
      })
      attempts.push({
        command: 'x-terminal-emulator',
        args: ['--working-directory', resolvedPath],
        label: 'Terminal',
      })
    } else {
      attempts.push({ command: 'ghostty', args: [resolvedPath], label: 'Ghostty' })
      attempts.push({ command: 'x-terminal-emulator', args: [resolvedPath], label: 'Terminal' })
    }
  }
  if (target === 'ghostty') {
    if (mode === 'directory') {
      attempts.push({
        command: 'ghostty',
        args: ['--working-directory', resolvedPath],
        label: 'Ghostty',
      })
    } else {
      attempts.push({ command: 'ghostty', args: [resolvedPath], label: 'Ghostty' })
    }
  }
  if (target === 'xcode') {
    attempts.push({ command: 'xdg-open', args: [resolvedPath], label: 'Editor' })
  }
  if (target === 'zed') {
    attempts.push({ command: 'zed', args: [resolvedPath], label: 'Zed' })
  }
  return attempts
}
