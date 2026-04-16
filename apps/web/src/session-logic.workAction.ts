import {
  isToolLifecycleAction,
  type ToolLifecycleAction,
  type ToolLifecycleItemType,
} from '@orxa-code/contracts'

const TITLE_TO_ACTION: Record<string, ToolLifecycleAction> = {
  read: 'read',
  edit: 'edit',
  multiedit: 'edit',
  write: 'create',
  grep: 'search',
  search: 'search',
  glob: 'list',
  list: 'list',
  ls: 'list',
  'web search': 'web',
  'web fetch': 'web',
  todos: 'todo',
}

function actionFromItemType(
  itemType: ToolLifecycleItemType | undefined
): ToolLifecycleAction | undefined {
  switch (itemType) {
    case 'command_execution':
      return 'command'
    case 'file_change':
      return 'edit'
    case 'web_search':
      return 'web'
    case 'collab_agent_tool_call':
    case 'mcp_tool_call':
    case 'dynamic_tool_call':
      return 'tool'
    default:
      return undefined
  }
}

export function extractWorkLogAction(
  payload: Record<string, unknown> | null
): ToolLifecycleAction | undefined {
  const raw = payload?.action
  if (typeof raw !== 'string') return undefined
  return isToolLifecycleAction(raw) ? raw : undefined
}

export function fallbackWorkLogAction(
  itemType: ToolLifecycleItemType | undefined,
  toolTitle: string | null | undefined,
  command: string | null | undefined
): ToolLifecycleAction | undefined {
  const normalizedTitle = toolTitle?.trim().toLowerCase() ?? ''
  const direct = TITLE_TO_ACTION[normalizedTitle]
  if (direct) return direct
  if (normalizedTitle.includes('todo')) return 'todo'
  const fromType = actionFromItemType(itemType)
  if (fromType) return fromType
  if (command && command.trim().length > 0) return 'command'
  return undefined
}
