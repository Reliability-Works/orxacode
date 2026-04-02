import type { OrxaEvent } from '@shared/ipc'
import {
  handleProjectRuntimeEvent,
  handleSessionRuntimeDeltaEvent,
  handleSessionRuntimeEvent,
  type ProjectRuntimeEventContext,
} from './app-core-project-events'

type AppCommandHandlers = {
  openSettings: () => void
  toggleWorkspaceSidebar: () => void
  toggleOperationsSidebar: () => void
  toggleBrowserSidebar: () => void
}

export type OrxaDiagnosticsEventContext = ProjectRuntimeEventContext &
  AppCommandHandlers & {
    bootstrap: () => Promise<void>
    setRuntime: (runtime: Extract<OrxaEvent, { type: 'runtime.status' }>['payload']) => void
    handleUpdaterTelemetry: (
      payload: Extract<OrxaEvent, { type: 'updater.telemetry' }>['payload']
    ) => void
    setBrowserRuntimeState: (
      payload: Extract<OrxaEvent, { type: 'browser.state' }>['payload']
    ) => void
    setMcpDevToolsState: (
      state: Extract<OrxaEvent, { type: 'mcp.devtools.status' }>['payload']['state']
    ) => void
    appendBrowserHistoryItem: (
      payload: Extract<OrxaEvent, { type: 'browser.history.added' }>['payload']
    ) => void
    clearBrowserHistory: () => void
    setBrowserActionRunning: (running: boolean) => void
  }

function applyAppCommand(
  command: Extract<OrxaEvent, { type: 'app.command' }>['payload']['command'],
  handlers: AppCommandHandlers
) {
  if (command === 'open-settings') {
    handlers.openSettings()
    return
  }
  if (command === 'toggle-workspace-sidebar') {
    handlers.toggleWorkspaceSidebar()
    return
  }
  if (command === 'toggle-operations-sidebar') {
    handlers.toggleOperationsSidebar()
    return
  }
  if (command === 'toggle-browser-sidebar') {
    handlers.toggleBrowserSidebar()
  }
}

function handleOpencodeGlobalEvent(
  event: Extract<OrxaEvent, { type: 'opencode.global' }>,
  bootstrap: () => Promise<void>
) {
  if (
    event.payload.event.type === 'project.updated' ||
    event.payload.event.type === 'global.disposed' ||
    event.payload.event.type === 'server.connected'
  ) {
    void bootstrap()
  }
}

export function handleOrxaDiagnosticsEvent(event: OrxaEvent, context: OrxaDiagnosticsEventContext) {
  if (event.type === 'runtime.status') {
    context.setRuntime(event.payload)
    return
  }

  if (event.type === 'runtime.error') {
    context.setStatusLine(event.payload.message)
    return
  }

  if (event.type === 'app.command') {
    applyAppCommand(event.payload.command, context)
    return
  }

  if (event.type === 'updater.telemetry') {
    context.handleUpdaterTelemetry(event.payload)
    return
  }

  if (event.type === 'browser.state') {
    context.setBrowserRuntimeState(event.payload)
    return
  }

  if (event.type === 'mcp.devtools.status') {
    context.setMcpDevToolsState(event.payload.state)
    return
  }

  if (event.type === 'browser.history.added') {
    context.appendBrowserHistoryItem(event.payload)
    return
  }

  if (event.type === 'browser.history.cleared') {
    context.clearBrowserHistory()
    return
  }

  if (event.type === 'browser.agent.action') {
    context.setBrowserActionRunning(false)
    return
  }

  if (event.type === 'opencode.global') {
    handleOpencodeGlobalEvent(event, context.bootstrap)
    return
  }

  if (event.type === 'opencode.project') {
    handleProjectRuntimeEvent(event, context)
    return
  }

  if (event.type === 'opencode.session') {
    handleSessionRuntimeEvent(event, context)
    return
  }

  if (event.type === 'opencode.session.runtime') {
    handleSessionRuntimeDeltaEvent(event, context)
  }
}
