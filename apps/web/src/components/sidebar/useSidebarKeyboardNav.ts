/**
 * useSidebarKeyboardNav — keyboard shortcut effects and thread jump labels.
 */

import { useEffect, useMemo } from 'react'
import { ThreadId } from '@orxa-code/contracts'
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHints,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from '../../keybindings'
import { isTerminalFocused } from '../../lib/terminalFocus'
import { useServerKeybindings } from '../../rpc/serverState'
import { getVisibleSidebarThreadIds, resolveAdjacentThreadId } from '../Sidebar.logic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SidebarKeyboardNavReturn {
  visibleSidebarThreadIds: ThreadId[]
  threadJumpLabelById: Map<ThreadId, string>
}

// ---------------------------------------------------------------------------
// Jump label computation (extracted to reduce hook body)
// ---------------------------------------------------------------------------

function buildThreadJumpCommandById(visibleSidebarThreadIds: ThreadId[]): Map<ThreadId, string> {
  const mapping = new Map<ThreadId, string>()
  for (const [index, threadId] of visibleSidebarThreadIds.entries()) {
    const jumpCommand = threadJumpCommandForIndex(index)
    if (!jumpCommand) return mapping
    mapping.set(threadId, jumpCommand)
  }
  return mapping
}

function buildThreadJumpLabelById(
  threadJumpCommandById: Map<ThreadId, string>,
  keybindings: ReturnType<typeof useServerKeybindings>,
  platform: string,
  routeTerminalOpen: boolean
): Map<ThreadId, string> {
  const mapping = new Map<ThreadId, string>()
  const opts = { platform, context: { terminalFocus: false, terminalOpen: routeTerminalOpen } }
  for (const [threadId, command] of threadJumpCommandById) {
    const label = shortcutLabelForCommand(
      keybindings,
      command as Parameters<typeof shortcutLabelForCommand>[1],
      opts
    )
    if (label) mapping.set(threadId, label)
  }
  return mapping
}

// ---------------------------------------------------------------------------
// Keyboard event handler factory (extracted to reduce hook body)
// ---------------------------------------------------------------------------

function createWindowKeyHandlers(opts: {
  keybindings: ReturnType<typeof useServerKeybindings>
  platform: string
  routeTerminalOpen: boolean
  routeThreadId: ThreadId | null
  visibleSidebarThreadIds: ThreadId[]
  threadJumpThreadIds: ThreadId[]
  navigateToThread: (threadId: ThreadId) => void
  updateThreadJumpHintsVisibility: (shouldShow: boolean) => void
}) {
  const getCtx = () => ({
    terminalFocus: isTerminalFocused(),
    terminalOpen: opts.routeTerminalOpen,
  })

  const onKeyDown = (event: KeyboardEvent) => {
    opts.updateThreadJumpHintsVisibility(
      shouldShowThreadJumpHints(event, opts.keybindings, {
        platform: opts.platform,
        context: getCtx(),
      })
    )
    if (event.defaultPrevented || event.repeat) return
    const command = resolveShortcutCommand(event, opts.keybindings, {
      platform: opts.platform,
      context: getCtx(),
    })
    const traversal = threadTraversalDirectionFromCommand(command)
    if (traversal !== null) {
      const target = resolveAdjacentThreadId({
        threadIds: opts.visibleSidebarThreadIds,
        currentThreadId: opts.routeThreadId,
        direction: traversal,
      })
      if (!target) return
      event.preventDefault()
      event.stopPropagation()
      opts.navigateToThread(target)
      return
    }
    const jumpIndex = threadJumpIndexFromCommand(command ?? '')
    if (jumpIndex === null) return
    const targetId = opts.threadJumpThreadIds[jumpIndex]
    if (!targetId) return
    event.preventDefault()
    event.stopPropagation()
    opts.navigateToThread(targetId)
  }

  const onKeyUp = (event: KeyboardEvent) => {
    opts.updateThreadJumpHintsVisibility(
      shouldShowThreadJumpHints(event, opts.keybindings, {
        platform: opts.platform,
        context: getCtx(),
      })
    )
  }

  const onBlur = () => opts.updateThreadJumpHintsVisibility(false)

  return { onKeyDown, onKeyUp, onBlur }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSidebarKeyboardNav(params: {
  keybindings: ReturnType<typeof useServerKeybindings>
  platform: string
  routeTerminalOpen: boolean
  routeThreadId: ThreadId | null
  renderedProjects: Array<{
    shouldShowThreadPanel?: boolean
    renderedThreads: Array<{ id: ThreadId }>
  }>
  navigateToThread: (threadId: ThreadId) => void
  updateThreadJumpHintsVisibility: (shouldShow: boolean) => void
}): SidebarKeyboardNavReturn {
  const {
    keybindings,
    platform,
    routeTerminalOpen,
    routeThreadId,
    renderedProjects,
    navigateToThread,
    updateThreadJumpHintsVisibility,
  } = params

  const visibleSidebarThreadIds = useMemo(
    () => getVisibleSidebarThreadIds(renderedProjects),
    [renderedProjects]
  )
  const threadJumpCommandById = useMemo(
    () => buildThreadJumpCommandById(visibleSidebarThreadIds),
    [visibleSidebarThreadIds]
  )
  const threadJumpThreadIds = useMemo(
    () => [...threadJumpCommandById.keys()],
    [threadJumpCommandById]
  )
  const threadJumpLabelById = useMemo(
    () => buildThreadJumpLabelById(threadJumpCommandById, keybindings, platform, routeTerminalOpen),
    [keybindings, platform, routeTerminalOpen, threadJumpCommandById]
  )

  useEffect(() => {
    const { onKeyDown, onKeyUp, onBlur } = createWindowKeyHandlers({
      keybindings,
      platform,
      routeTerminalOpen,
      routeThreadId,
      visibleSidebarThreadIds,
      threadJumpThreadIds,
      navigateToThread,
      updateThreadJumpHintsVisibility,
    })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [
    keybindings,
    navigateToThread,
    visibleSidebarThreadIds,
    platform,
    routeTerminalOpen,
    routeThreadId,
    threadJumpThreadIds,
    updateThreadJumpHintsVisibility,
  ])

  return { visibleSidebarThreadIds, threadJumpLabelById }
}
