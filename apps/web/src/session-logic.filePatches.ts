import type { ToolFilePatch, ToolLifecycleAction } from '@orxa-code/contracts'
import { asObjectRecord } from '@orxa-code/shared/records'

export function extractFilePatches(payload: Record<string, unknown> | null): ToolFilePatch[] {
  const raw = payload?.filePatches
  if (!Array.isArray(raw)) return []
  const patches: ToolFilePatch[] = []
  for (const candidate of raw) {
    const record = asObjectRecord(candidate)
    if (!record) continue
    const path = typeof record.path === 'string' ? record.path : null
    const action = typeof record.action === 'string' ? record.action : null
    const patchText = typeof record.patchText === 'string' ? record.patchText : null
    if (!path || !action || !patchText) continue
    patches.push({
      path,
      action: action as ToolLifecycleAction,
      patchText,
    })
  }
  return patches
}
