/**
 * useSidebarProjectTitleHandlers — project title click / keyboard / pointer
 * handlers. Split out of useSidebarProjectActions to keep hooks under the
 * max-lines limit.
 */

import { useCallback, type PointerEvent } from 'react'
import type { ProjectId, ThreadId } from '@orxa-code/contracts'
import { isMacPlatform } from '../../lib/utils'
import { isContextMenuPointerDown } from '../Sidebar.logic'

export interface UseSidebarProjectTitleHandlersParams {
  toggleProject: (projectId: ProjectId) => void
  selectedThreadIds: ReadonlySet<ThreadId>
  clearSelection: () => void
  dragInProgressRef: React.MutableRefObject<boolean>
  suppressProjectClickAfterDragRef: React.MutableRefObject<boolean>
  suppressProjectClickForContextMenuRef: React.MutableRefObject<boolean>
}

function shouldSuppressTitleClick(
  event: React.MouseEvent<HTMLButtonElement>,
  refs: {
    suppressProjectClickForContextMenuRef: React.MutableRefObject<boolean>
    dragInProgressRef: React.MutableRefObject<boolean>
    suppressProjectClickAfterDragRef: React.MutableRefObject<boolean>
  }
): boolean {
  if (refs.suppressProjectClickForContextMenuRef.current) {
    refs.suppressProjectClickForContextMenuRef.current = false
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  if (refs.dragInProgressRef.current) {
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  if (refs.suppressProjectClickAfterDragRef.current) {
    refs.suppressProjectClickAfterDragRef.current = false
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  return false
}

export function useSidebarProjectTitleHandlers(params: UseSidebarProjectTitleHandlersParams) {
  const {
    toggleProject,
    selectedThreadIds,
    clearSelection,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
  } = params

  const handleProjectTitleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, projectId: ProjectId) => {
      if (
        shouldSuppressTitleClick(event, {
          suppressProjectClickForContextMenuRef,
          dragInProgressRef,
          suppressProjectClickAfterDragRef,
        })
      ) {
        return
      }
      if (selectedThreadIds.size > 0) clearSelection()
      toggleProject(projectId)
    },
    [
      clearSelection,
      dragInProgressRef,
      selectedThreadIds.size,
      suppressProjectClickAfterDragRef,
      suppressProjectClickForContextMenuRef,
      toggleProject,
    ]
  )
  const handleProjectTitleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, projectId: ProjectId) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      if (!dragInProgressRef.current) toggleProject(projectId)
    },
    [dragInProgressRef, toggleProject]
  )
  const handleProjectTitlePointerDownCapture = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      suppressProjectClickForContextMenuRef.current = false
      if (
        isContextMenuPointerDown({
          button: event.button,
          ctrlKey: event.ctrlKey,
          isMac: isMacPlatform(navigator.platform),
        })
      ) {
        event.stopPropagation()
      }
      suppressProjectClickAfterDragRef.current = false
    },
    [suppressProjectClickAfterDragRef, suppressProjectClickForContextMenuRef]
  )

  return {
    handleProjectTitleClick,
    handleProjectTitleKeyDown,
    handleProjectTitlePointerDownCapture,
  }
}
