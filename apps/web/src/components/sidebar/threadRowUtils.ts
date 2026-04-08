/**
 * Pure utility functions for ThreadRow status computation.
 * Separated from ThreadRow.tsx to satisfy react-refresh/only-export-components.
 */
import type { GitStatusResult } from '@orxa-code/contracts'

export interface TerminalStatusIndicator {
  label: 'Terminal process running'
  colorClass: string
  pulse: boolean
}

export interface PrStatusIndicator {
  label: 'PR open' | 'PR closed' | 'PR merged'
  colorClass: string
  tooltip: string
  url: string
}

export type ThreadPr = GitStatusResult['pr']

export function terminalStatusFromRunningIds(
  runningTerminalIds: string[]
): TerminalStatusIndicator | null {
  if (runningTerminalIds.length === 0) {
    return null
  }
  return {
    label: 'Terminal process running',
    colorClass: 'text-teal-600 dark:text-teal-300/90',
    pulse: true,
  }
}

export function prStatusIndicator(pr: ThreadPr): PrStatusIndicator | null {
  if (!pr) return null
  if (pr.state === 'open')
    return {
      label: 'PR open',
      colorClass: 'text-emerald-600 dark:text-emerald-300/90',
      tooltip: `#${pr.number} PR open: ${pr.title}`,
      url: pr.url,
    }
  if (pr.state === 'closed')
    return {
      label: 'PR closed',
      colorClass: 'text-zinc-500 dark:text-zinc-400/80',
      tooltip: `#${pr.number} PR closed: ${pr.title}`,
      url: pr.url,
    }
  if (pr.state === 'merged')
    return {
      label: 'PR merged',
      colorClass: 'text-violet-600 dark:text-violet-300/90',
      tooltip: `#${pr.number} PR merged: ${pr.title}`,
      url: pr.url,
    }
  return null
}
