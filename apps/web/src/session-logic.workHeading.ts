import type { ToolLifecycleAction } from '@orxa-code/contracts'

import type { WorkLogEntry } from './session-logic.activity'
import { isFileActionKind, resolveEffectivePathAction } from './session-logic.perPathActions'

const ACTION_LABELS: Record<
  ToolLifecycleAction,
  { readonly verb: string; readonly singular: string; readonly plural: string }
> = {
  read: { verb: 'Read', singular: 'file', plural: 'files' },
  edit: { verb: 'Edited', singular: 'file', plural: 'files' },
  create: { verb: 'Created', singular: 'file', plural: 'files' },
  delete: { verb: 'Deleted', singular: 'file', plural: 'files' },
  search: { verb: 'Explored', singular: 'time', plural: 'times' },
  list: { verb: 'Listed', singular: 'path', plural: 'paths' },
  command: { verb: 'Ran', singular: 'command', plural: 'commands' },
  web: { verb: 'Searched', singular: 'page', plural: 'pages' },
  todo: { verb: 'Updated', singular: 'todo list', plural: 'todo lists' },
  tool: { verb: 'Used', singular: 'tool', plural: 'tools' },
}

const ACTION_ORDER: ReadonlyArray<ToolLifecycleAction> = [
  'create',
  'edit',
  'delete',
  'read',
  'search',
  'list',
  'command',
  'web',
  'todo',
  'tool',
]

function joinClauses(clauses: ReadonlyArray<string>): string {
  if (clauses.length === 0) return ''
  if (clauses.length === 1) return clauses[0] ?? ''
  if (clauses.length === 2) return `${clauses[0]}, ${clauses[1]}`
  const head = clauses.slice(0, -1).join(', ')
  return `${head}, ${clauses[clauses.length - 1]}`
}

function clauseForAction(action: ToolLifecycleAction, count: number): string {
  const labels = ACTION_LABELS[action]
  const noun = count === 1 ? labels.singular : labels.plural
  return `${labels.verb} ${count} ${noun}`
}

function normalizeAction(action: ToolLifecycleAction): ToolLifecycleAction {
  return action === 'create' ? 'edit' : action
}

function incrementCount(counts: Map<ToolLifecycleAction, number>, action: ToolLifecycleAction) {
  const normalized = normalizeAction(action)
  counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
}

function accumulateFileEntry(
  entry: WorkLogEntry,
  action: ToolLifecycleAction,
  counts: Map<ToolLifecycleAction, number>,
  fallbackWrittenPaths: Set<string>
) {
  const perPath = entry.perPathActions
  if (perPath) {
    for (const effective of Object.values(perPath)) incrementCount(counts, effective)
    return
  }
  const paths = entry.changedFiles && entry.changedFiles.length > 0 ? entry.changedFiles : null
  if (!paths) {
    incrementCount(counts, action)
    return
  }
  for (const path of paths) {
    incrementCount(counts, resolveEffectivePathAction(action, path, fallbackWrittenPaths))
  }
}

export function synthesizeWorkGroupHeading(entries: ReadonlyArray<WorkLogEntry>): string {
  if (entries.length === 0) return 'Work log'
  const onlyInfo = entries.every(entry => entry.tone === 'info' || entry.tone === 'thinking')
  if (onlyInfo) return 'Work log'

  const counts = new Map<ToolLifecycleAction, number>()
  const fallbackWrittenPaths = new Set<string>()
  let uncategorized = 0
  for (const entry of entries) {
    if (entry.tone !== 'tool') continue
    if (!entry.action) {
      uncategorized += 1
      continue
    }
    if (!isFileActionKind(entry.action)) {
      incrementCount(counts, entry.action)
      continue
    }
    accumulateFileEntry(entry, entry.action, counts, fallbackWrittenPaths)
  }

  const clauses: string[] = []
  for (const action of ACTION_ORDER) {
    const count = counts.get(action)
    if (count && count > 0) clauses.push(clauseForAction(action, count))
  }
  if (uncategorized > 0) clauses.push(clauseForAction('tool', uncategorized))

  if (clauses.length === 0) return 'Tool calls'
  return joinClauses(clauses)
}
