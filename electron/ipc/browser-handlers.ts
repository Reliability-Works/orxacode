import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC, type OrxaEvent } from '../../shared/ipc'
import type { BrowserController } from '../services/browser-controller'
import type { OpencodeService } from '../services/opencode-service'
import {
  assertBoolean,
  assertBrowserAgentActionRequest,
  assertBrowserBoundsInput,
  assertFiniteNumber,
  assertString,
} from './validators'

type BrowserHandlersDeps = {
  service: OpencodeService
  getBrowserController: () => BrowserController | null
  assertBrowserSender: (event: IpcMainInvokeEvent) => void
  resolveCdpPort: () => Promise<number>
  publishEvent: (event: OrxaEvent) => void
}

function requireBrowserController(
  getBrowserController: () => BrowserController | null
): BrowserController {
  const controller = getBrowserController()
  if (!controller) {
    throw new Error('Browser controller is not initialized')
  }
  return controller
}

function registerBrowserStateHandlers(
  getBrowserController: () => BrowserController | null,
  assertBrowserSender: (event: IpcMainInvokeEvent) => void
) {
  ipcMain.handle(IPC.browserGetState, async event => {
    assertBrowserSender(event)
    return requireBrowserController(getBrowserController).getState()
  })
  ipcMain.handle(IPC.browserSetVisible, async (event, visible: unknown) => {
    assertBrowserSender(event)
    return requireBrowserController(getBrowserController).setVisible(
      assertBoolean(visible, 'visible')
    )
  })
  ipcMain.handle(IPC.browserSetBounds, async (event, bounds: unknown) => {
    assertBrowserSender(event)
    return requireBrowserController(getBrowserController).setBounds(assertBrowserBoundsInput(bounds))
  })
  ipcMain.handle(IPC.browserOpenTab, async (event, url?: unknown, activate?: unknown) => {
    assertBrowserSender(event)
    return requireBrowserController(getBrowserController).openTab(
      typeof url === 'string' ? url : undefined,
      activate === undefined ? true : assertBoolean(activate, 'activate')
    )
  })
  ipcMain.handle(IPC.browserCloseTab, async (event, tabID?: unknown) => {
    assertBrowserSender(event)
    return requireBrowserController(getBrowserController).closeTab(
      typeof tabID === 'string' ? tabID : undefined
    )
  })
  ipcMain.handle(IPC.browserSwitchTab, async (event, tabID: unknown) => {
    assertBrowserSender(event)
    return requireBrowserController(getBrowserController).switchTab(assertString(tabID, 'tabID'))
  })
  ipcMain.handle(IPC.browserNavigate, async (event, url: unknown, tabID?: unknown) => {
    assertBrowserSender(event)
    return requireBrowserController(getBrowserController).navigate(
      assertString(url, 'url'),
      typeof tabID === 'string' ? tabID : undefined
    )
  })
  ipcMain.handle(IPC.browserBack, async (event, tabID?: unknown) => {
    assertBrowserSender(event)
    return requireBrowserController(getBrowserController).back(
      typeof tabID === 'string' ? tabID : undefined
    )
  })
  ipcMain.handle(IPC.browserForward, async (event, tabID?: unknown) => {
    assertBrowserSender(event)
    return requireBrowserController(getBrowserController).forward(
      typeof tabID === 'string' ? tabID : undefined
    )
  })
  ipcMain.handle(IPC.browserReload, async (event, tabID?: unknown) => {
    assertBrowserSender(event)
    return requireBrowserController(getBrowserController).reload(
      typeof tabID === 'string' ? tabID : undefined
    )
  })
  ipcMain.handle(IPC.browserListHistory, async (event, limit?: unknown) => {
    assertBrowserSender(event)
    const parsedLimit =
      limit === undefined ? undefined : Math.floor(assertFiniteNumber(limit, 'limit'))
    return requireBrowserController(getBrowserController).listHistory(parsedLimit)
  })
  ipcMain.handle(IPC.browserClearHistory, async event => {
    assertBrowserSender(event)
    return requireBrowserController(getBrowserController).clearHistory()
  })
  ipcMain.handle(IPC.browserPerformAgentAction, async (event, request: unknown) => {
    assertBrowserSender(event)
    return requireBrowserController(getBrowserController).performAgentAction(
      assertBrowserAgentActionRequest(request)
    )
  })
}

function registerBrowserInspectHandlers(
  getBrowserController: () => BrowserController | null,
  assertBrowserSender: (event: IpcMainInvokeEvent) => void,
  publishEvent: (event: OrxaEvent) => void
) {
  ipcMain.handle(IPC.browserInspectEnable, async event => {
    assertBrowserSender(event)
    const controller = requireBrowserController(getBrowserController)
    await controller.enableInspect(annotation => {
      publishEvent({ type: 'browser.inspect.annotation', payload: annotation } as OrxaEvent)
    })
    return { ok: true }
  })

  ipcMain.handle(IPC.browserInspectDisable, async event => {
    assertBrowserSender(event)
    await requireBrowserController(getBrowserController).disableInspect()
    return { ok: true }
  })
}

function registerMcpDevToolsHandlers(
  service: OpencodeService,
  assertBrowserSender: (event: IpcMainInvokeEvent) => void,
  resolveCdpPort: () => Promise<number>,
  publishEvent: (event: OrxaEvent) => void
) {
  ipcMain.handle(IPC.mcpDevToolsStart, async (event, directory: string) => {
    assertBrowserSender(event)
    let cdpPort = 0
    try {
      cdpPort = await resolveCdpPort()
    } catch (portError) {
      const message = `CDP port resolution failed: ${portError instanceof Error ? portError.message : String(portError)}`
      console.error('[MCP DevTools]', message)
      publishEvent({
        type: 'mcp.devtools.status',
        payload: { state: 'error', cdpPort: 0, error: message },
      })
      return { state: 'error' as const, cdpPort: 0, error: message }
    }
    try {
      console.log(`[MCP DevTools] Registering with CDP port ${cdpPort} for ${directory}`)
      await service.registerMcpDevTools(directory, cdpPort)
      console.log('[MCP DevTools] Connected successfully')
      publishEvent({ type: 'mcp.devtools.status', payload: { state: 'running', cdpPort } })
      return { state: 'running' as const, cdpPort }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[MCP DevTools] Registration failed:', message)
      publishEvent({
        type: 'mcp.devtools.status',
        payload: { state: 'error', cdpPort, error: message },
      })
      return { state: 'error' as const, cdpPort, error: message }
    }
  })

  ipcMain.handle(IPC.mcpDevToolsStop, async (event, directory: string) => {
    assertBrowserSender(event)
    try {
      await service.disconnectMcpDevTools(directory)
    } catch {
      // ignore — may already be disconnected
    }
    publishEvent({ type: 'mcp.devtools.status', payload: { state: 'stopped' } })
    return { state: 'stopped' as const }
  })

  ipcMain.handle(IPC.mcpDevToolsGetStatus, async (event, directory: string) => {
    assertBrowserSender(event)
    try {
      const status = await service.getMcpDevToolsStatus(directory)
      const mcpMap = status as Record<string, { status?: string }> | undefined
      const entry = mcpMap?.['chrome-devtools']
      if (entry?.status === 'connected') {
        return { state: 'running' as const }
      }
      if (entry?.status === 'connecting') {
        return { state: 'starting' as const }
      }
      if (entry?.status === 'error') {
        return { state: 'error' as const }
      }
      return { state: 'stopped' as const }
    } catch {
      return { state: 'stopped' as const }
    }
  })

  ipcMain.handle(IPC.mcpDevToolsListTools, async event => {
    assertBrowserSender(event)
    return []
  })
}

export function registerBrowserHandlers({
  service,
  getBrowserController,
  assertBrowserSender,
  resolveCdpPort,
  publishEvent,
}: BrowserHandlersDeps) {
  registerBrowserStateHandlers(getBrowserController, assertBrowserSender)
  registerBrowserInspectHandlers(getBrowserController, assertBrowserSender, publishEvent)
  registerMcpDevToolsHandlers(service, assertBrowserSender, resolveCdpPort, publishEvent)
}
