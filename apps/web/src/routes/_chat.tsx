import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { useHandleNewThread } from '../hooks/useHandleNewThread'
import { isTerminalFocused } from '../lib/terminalFocus'
import { resolveShortcutCommand } from '../keybindings'
import { selectThreadTerminalState, useTerminalStateStore } from '../terminalStateStore'
import { useThreadSelectionStore } from '../threadSelectionStore'
import { resolveSidebarNewThreadEnvMode } from '~/components/Sidebar.logic'
import { useSettings } from '~/hooks/useSettings'
import { useServerKeybindings } from '~/rpc/serverState'

function createNewLocalThreadAction(params: {
  defaultThreadEnvMode: ReturnType<typeof useSettings>['defaultThreadEnvMode']
  handleNewThread: ReturnType<typeof useHandleNewThread>['handleNewThread']
}) {
  return (projectId: NonNullable<ReturnType<typeof useHandleNewThread>['defaultProjectId']>) => {
    void params.handleNewThread(projectId, {
      envMode: resolveSidebarNewThreadEnvMode({
        defaultEnvMode: params.defaultThreadEnvMode,
      }),
    })
  }
}

function createInheritedThreadAction(params: {
  activeDraftThread: ReturnType<typeof useHandleNewThread>['activeDraftThread']
  activeThread: ReturnType<typeof useHandleNewThread>['activeThread']
  handleNewThread: ReturnType<typeof useHandleNewThread>['handleNewThread']
}) {
  return (projectId: NonNullable<ReturnType<typeof useHandleNewThread>['defaultProjectId']>) => {
    void params.handleNewThread(projectId, {
      branch: params.activeThread?.branch ?? params.activeDraftThread?.branch ?? null,
      worktreePath:
        params.activeThread?.worktreePath ?? params.activeDraftThread?.worktreePath ?? null,
      envMode:
        params.activeDraftThread?.envMode ??
        (params.activeThread?.worktreePath ? 'worktree' : 'local'),
    })
  }
}

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore(state => state.clearSelection)
  const selectedThreadIdsSize = useThreadSelectionStore(state => state.selectedThreadIds.size)
  const { activeDraftThread, activeThread, defaultProjectId, handleNewThread, routeThreadId } =
    useHandleNewThread()
  const keybindings = useServerKeybindings()
  const terminalOpen = useTerminalStateStore(state =>
    routeThreadId
      ? selectThreadTerminalState(state.terminalStateByThreadId, routeThreadId).terminalOpen
      : false
  )
  const appSettings = useSettings()
  const createNewLocalThread = createNewLocalThreadAction({
    defaultThreadEnvMode: appSettings.defaultThreadEnvMode,
    handleNewThread,
  })
  const createInheritedThread = createInheritedThreadAction({
    activeDraftThread,
    activeThread,
    handleNewThread,
  })

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return

      if (event.key === 'Escape' && selectedThreadIdsSize > 0) {
        event.preventDefault()
        clearSelection()
        return
      }

      const projectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? defaultProjectId
      if (!projectId) return

      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      })

      if (command === 'chat.newLocal') {
        event.preventDefault()
        event.stopPropagation()
        createNewLocalThread(projectId)
        return
      }

      if (command === 'chat.new') {
        event.preventDefault()
        event.stopPropagation()
        createInheritedThread(projectId)
        return
      }
    }

    window.addEventListener('keydown', onWindowKeyDown)
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown)
    }
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    createInheritedThread,
    createNewLocalThread,
    keybindings,
    defaultProjectId,
    selectedThreadIdsSize,
    terminalOpen,
  ])

  return null
}

function ChatRouteLayout() {
  return (
    <>
      <ChatRouteGlobalShortcuts />
      <Outlet />
    </>
  )
}

export const Route = createFileRoute('/_chat')({
  component: ChatRouteLayout,
})
