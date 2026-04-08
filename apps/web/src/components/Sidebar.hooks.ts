/**
 * Sidebar hooks — barrel re-export.
 *
 * Each hook lives in its own focused module under `sidebar/`:
 * - `sidebar/useSidebarDerivedData.ts`    — memoized computations & queries
 * - `sidebar/useSidebarThreadActions.ts`  — thread click / navigate / context-menu / rename / archive
 * - `sidebar/useSidebarProjectActions.ts` — project CRUD / DnD / add-project
 * - `sidebar/useSidebarKeyboardNav.ts`    — keyboard shortcut effect + jump data
 * - `sidebar/useSidebarDesktopUpdate.ts`  — desktop update state + handler
 */

export type { SidebarDerivedData } from './sidebar/useSidebarDerivedData'
export { useSidebarDerivedData, sidebarThreadSnapshotCache } from './sidebar/useSidebarDerivedData'
export type { SidebarThreadSnapshot } from './sidebar/ThreadRow'

export type { SidebarThreadActionsReturn } from './sidebar/useSidebarThreadActions'
export { useSidebarThreadActions } from './sidebar/useSidebarThreadActions'

export type { SidebarProjectActionsReturn } from './sidebar/useSidebarProjectActions'
export { useSidebarProjectActions } from './sidebar/useSidebarProjectActions'

export type { SidebarKeyboardNavReturn } from './sidebar/useSidebarKeyboardNav'
export { useSidebarKeyboardNav } from './sidebar/useSidebarKeyboardNav'

export type { SidebarDesktopUpdateReturn } from './sidebar/useSidebarDesktopUpdate'
export { useSidebarDesktopUpdate } from './sidebar/useSidebarDesktopUpdate'
