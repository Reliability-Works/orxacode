import { useMemo } from 'react'
import {
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ThreadTerminalGroup,
} from '../types'

export interface ResolvedTerminalLayout {
  normalizedTerminalIds: string[]
  resolvedActiveTerminalId: string
  resolvedTerminalGroups: ThreadTerminalGroup[]
  resolvedActiveGroupIndex: number
  visibleTerminalIds: string[]
  terminalLabelById: Map<string, string>
  hasTerminalSidebar: boolean
  isSplitView: boolean
  showGroupHeaders: boolean
  hasReachedSplitLimit: boolean
}

function normalizeTerminalIds(terminalIds: string[]): string[] {
  const cleaned = [...new Set(terminalIds.map(id => id.trim()).filter(id => id.length > 0))]
  return cleaned.length > 0 ? cleaned : [DEFAULT_THREAD_TERMINAL_ID]
}

function assignUniqueGroupId(usedGroupIds: Set<string>, groupId: string): string {
  if (!usedGroupIds.has(groupId)) {
    usedGroupIds.add(groupId)
    return groupId
  }
  let suffix = 2
  while (usedGroupIds.has(`${groupId}-${suffix}`)) {
    suffix += 1
  }
  const uniqueGroupId = `${groupId}-${suffix}`
  usedGroupIds.add(uniqueGroupId)
  return uniqueGroupId
}

function resolveTerminalGroupsList(
  normalizedTerminalIds: string[],
  resolvedActiveTerminalId: string,
  terminalGroups: ThreadTerminalGroup[]
): ThreadTerminalGroup[] {
  const validTerminalIdSet = new Set(normalizedTerminalIds)
  const assignedTerminalIds = new Set<string>()
  const usedGroupIds = new Set<string>()
  const nextGroups: ThreadTerminalGroup[] = []

  for (const terminalGroup of terminalGroups) {
    const nextTerminalIds = [
      ...new Set(terminalGroup.terminalIds.map(id => id.trim()).filter(id => id.length > 0)),
    ].filter(tid => validTerminalIdSet.has(tid) && !assignedTerminalIds.has(tid))
    if (nextTerminalIds.length === 0) continue
    for (const tid of nextTerminalIds) assignedTerminalIds.add(tid)
    const baseGroupId =
      terminalGroup.id.trim().length > 0
        ? terminalGroup.id.trim()
        : `group-${nextTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID}`
    nextGroups.push({
      id: assignUniqueGroupId(usedGroupIds, baseGroupId),
      terminalIds: nextTerminalIds,
    })
  }

  for (const terminalId of normalizedTerminalIds) {
    if (assignedTerminalIds.has(terminalId)) continue
    nextGroups.push({
      id: assignUniqueGroupId(usedGroupIds, `group-${terminalId}`),
      terminalIds: [terminalId],
    })
  }

  if (nextGroups.length > 0) return nextGroups
  return [{ id: `group-${resolvedActiveTerminalId}`, terminalIds: [resolvedActiveTerminalId] }]
}

function resolveActiveGroupIndex(
  resolvedTerminalGroups: ThreadTerminalGroup[],
  activeTerminalGroupId: string,
  resolvedActiveTerminalId: string
): number {
  const indexById = resolvedTerminalGroups.findIndex(g => g.id === activeTerminalGroupId)
  if (indexById >= 0) return indexById
  const indexByTerminal = resolvedTerminalGroups.findIndex(g =>
    g.terminalIds.includes(resolvedActiveTerminalId)
  )
  return indexByTerminal >= 0 ? indexByTerminal : 0
}

export function useResolvedTerminalLayout(
  terminalIds: string[],
  activeTerminalId: string,
  terminalGroups: ThreadTerminalGroup[],
  activeTerminalGroupId: string
): ResolvedTerminalLayout {
  const normalizedTerminalIds = useMemo(() => normalizeTerminalIds(terminalIds), [terminalIds])

  const resolvedActiveTerminalId = normalizedTerminalIds.includes(activeTerminalId)
    ? activeTerminalId
    : (normalizedTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID)

  const resolvedTerminalGroups = useMemo(
    () =>
      resolveTerminalGroupsList(normalizedTerminalIds, resolvedActiveTerminalId, terminalGroups),
    [normalizedTerminalIds, resolvedActiveTerminalId, terminalGroups]
  )

  const resolvedActiveGroupIndex = useMemo(
    () =>
      resolveActiveGroupIndex(
        resolvedTerminalGroups,
        activeTerminalGroupId,
        resolvedActiveTerminalId
      ),
    [activeTerminalGroupId, resolvedActiveTerminalId, resolvedTerminalGroups]
  )

  const visibleTerminalIds = resolvedTerminalGroups[resolvedActiveGroupIndex]?.terminalIds ?? [
    resolvedActiveTerminalId,
  ]
  const hasTerminalSidebar = normalizedTerminalIds.length > 1
  const isSplitView = visibleTerminalIds.length > 1
  const showGroupHeaders =
    resolvedTerminalGroups.length > 1 || resolvedTerminalGroups.some(g => g.terminalIds.length > 1)
  const hasReachedSplitLimit = visibleTerminalIds.length >= MAX_TERMINALS_PER_GROUP

  const terminalLabelById = useMemo(
    () => new Map(normalizedTerminalIds.map((tid, index) => [tid, `Terminal ${index + 1}`])),
    [normalizedTerminalIds]
  )

  return {
    normalizedTerminalIds,
    resolvedActiveTerminalId,
    resolvedTerminalGroups,
    resolvedActiveGroupIndex,
    visibleTerminalIds,
    terminalLabelById,
    hasTerminalSidebar,
    isSplitView,
    showGroupHeaders,
    hasReachedSplitLimit,
  }
}
