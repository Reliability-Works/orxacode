import type { ToolLifecycleAction } from '@orxa-code/contracts'

export function isFileActionKind(action: ToolLifecycleAction | undefined): boolean {
  return action === 'edit' || action === 'create' || action === 'delete'
}

export function resolveEffectivePathAction(
  action: ToolLifecycleAction,
  path: string,
  writtenPaths: Set<string>
): ToolLifecycleAction {
  if (action === 'delete') {
    writtenPaths.delete(path)
    return 'delete'
  }
  if (writtenPaths.has(path)) return 'edit'
  writtenPaths.add(path)
  return action
}
