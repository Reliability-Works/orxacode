import type { RefObject } from 'react'
import type { CodexCollaborationMode, CodexModelEntry } from '@shared/ipc'
import type { PermissionMode } from '../types/app'

export interface CodexPaneProps {
  directory: string
  sessionStorageKey: string
  isDraft?: boolean
  cachedCollaborationModes?: CodexCollaborationMode[]
  cachedModels?: CodexModelEntry[]
  titleLocked?: boolean
  onExit: () => void
  onFirstMessage?: () => void
  onTitleChange?: (title: string) => void
  notifyOnAwaitingInput?: boolean
  subagentSystemNotificationsEnabled?: boolean
  codexAccessMode?: string
  defaultReasoningEffort?: string
  permissionMode: PermissionMode
  onPermissionModeChange: (mode: PermissionMode) => void
  codexPath?: string
  codexArgs?: string
  branchMenuOpen: boolean
  setBranchMenuOpen: (updater: (value: boolean) => boolean) => void
  branchControlWidthCh: number
  branchLoading: boolean
  branchSwitching: boolean
  hasActiveProject: boolean
  branchCurrent?: string
  branchDisplayValue: string
  branchSearchInputRef: RefObject<HTMLInputElement | null>
  branchQuery: string
  setBranchQuery: (value: string) => void
  branchActionError: string | null
  clearBranchActionError: () => void
  checkoutBranch: (name: string) => void | Promise<void>
  filteredBranches: string[]
  openBranchCreateModal: () => void | Promise<void>
  onOpenFileReference?: (reference: string) => void
  browserModeEnabled?: boolean
  setBrowserModeEnabled?: (enabled: boolean) => void
}
