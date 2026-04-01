import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { CodexService } from '../services/codex-service'
import type { PerformanceTelemetryService } from '../services/performance-telemetry-service'
import { readClaudeUsageStats, readCodexUsageStats } from '../services/usage-stats-service'
import { registerMeasuredHandler } from './ipc-performance'
import { assertString } from './validators'

type CodexHandlersDeps = {
  codexService: CodexService
  performanceTelemetryService: PerformanceTelemetryService
}

export function registerCodexHandlers({
  codexService,
  performanceTelemetryService,
}: CodexHandlersDeps) {
  registerCodexUsageHandlers()
  registerCodexMaintenanceHandlers(codexService)
  registerCodexLifecycleHandlers(codexService, performanceTelemetryService)
  registerCodexTurnHandlers(codexService, performanceTelemetryService)
  registerCodexApprovalHandlers(codexService)
  registerCodexInterruptHandlers(codexService)
}

function registerCodexUsageHandlers() {
  ipcMain.handle(IPC.getClaudeUsageStats, async () => readClaudeUsageStats())
  ipcMain.handle(IPC.getCodexUsageStats, async () => readCodexUsageStats())
}

function registerCodexMaintenanceHandlers(codexService: CodexService) {
  ipcMain.handle(IPC.codexDoctor, async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    try {
      const { stdout, stderr } = await execFileAsync('codex', ['doctor'], {
        timeout: 15000,
        env: { ...process.env },
      })
      const output = (stdout + '\n' + stderr).trim()
      const versionMatch = output.match(/version[:\s]+([^\n]+)/i)
      const version = versionMatch ? versionMatch[1]!.trim() : 'unknown'
      const appServerOk = /app.server[:\s]*(ok|running|connected)/i.test(output)
        ? ('ok' as const)
        : /app.server/i.test(output)
          ? ('error' as const)
          : ('unknown' as const)
      const nodeOk = /node[:\s]*(ok|found|v\d)/i.test(output)
        ? ('ok' as const)
        : /node/i.test(output)
          ? ('error' as const)
          : ('unknown' as const)
      let codexPath = 'codex'
      try {
        const whichResult = await execFileAsync('which', ['codex'], { timeout: 5000 })
        codexPath = whichResult.stdout.trim() || 'codex'
      } catch {
        // keep default
      }
      return { version, appServer: appServerOk, node: nodeOk, path: codexPath, raw: output }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        version: 'unknown',
        appServer: 'error' as const,
        node: 'unknown' as const,
        path: '',
        raw: `codex doctor failed: ${message}`,
      }
    }
  })

  ipcMain.handle(IPC.codexUpdate, async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    try {
      const { stdout, stderr } = await execFileAsync('npm', ['update', '-g', '@openai/codex'], {
        timeout: 60000,
        env: { ...process.env },
      })
      const output = (stdout + '\n' + stderr).trim()
      const alreadyUpToDate = /up to date|already|unchanged/i.test(output)
      return {
        ok: true,
        message: alreadyUpToDate ? 'Already up to date' : `Updated: ${output.slice(0, 200)}`,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message: `Update failed: ${message}` }
    }
  })

  ipcMain.handle(IPC.codexListModels, async () => {
    if (codexService.state.status === 'connected') {
      const live = await codexService.listModels()
      if (live.length > 0) return live
    }
    return codexService.models
  })

  ipcMain.handle(IPC.codexListCollaborationModes, async () => {
    if (codexService.state.status === 'connected') {
      const live = await codexService.listCollaborationModes()
      if (live.length > 0) return live
    }
    return codexService.collaborationModes
  })
}

function registerCodexLifecycleHandlers(
  codexService: CodexService,
  performanceTelemetryService: PerformanceTelemetryService
) {
  ipcMain.handle(IPC.codexStart, async (_event, cwd?: unknown, options?: unknown) => {
    const opts =
      options && typeof options === 'object'
        ? (options as { codexPath?: string; codexArgs?: string })
        : undefined
    return codexService.start(typeof cwd === 'string' ? cwd : undefined, opts)
  })

  ipcMain.handle(IPC.codexStop, async () => codexService.stop())
  ipcMain.handle(IPC.codexGetState, async () => codexService.state)
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.codexStartThread,
    'codex',
    async (_event, options?: unknown) => {
      const opts = (options ?? {}) as {
        model?: string
        cwd?: string
        title?: string
        approvalPolicy?: string
        sandbox?: string
      }
      return codexService.startThread(opts)
    }
  )
  ipcMain.handle(IPC.codexListWorkspaceThreads, async (_event, workspaceRoot: unknown) =>
    codexService.listWorkspaceThreads(assertString(workspaceRoot, 'workspaceRoot'))
  )
  ipcMain.handle(IPC.codexListThreads, async (_event, options?: unknown) => {
    const opts = (options ?? {}) as { cursor?: string | null; limit?: number; archived?: boolean }
    return codexService.listThreads(opts)
  })
  ipcMain.handle(IPC.codexListBrowserThreads, async () => codexService.listBrowserThreads())
  ipcMain.handle(IPC.codexGetThreadRuntime, async (_event, threadId: unknown) =>
    codexService.getThreadRuntime(assertString(threadId, 'threadId'))
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.codexResumeThread,
    'codex',
    async (_event, threadId: unknown) =>
      codexService.resumeThread(assertString(threadId, 'threadId'))
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.codexResumeProviderThread,
    'codex',
    async (_event, threadId: unknown, directory: unknown) =>
      codexService.resumeProviderThread(
        assertString(threadId, 'threadId'),
        assertString(directory, 'directory')
      )
  )
  ipcMain.handle(IPC.codexArchiveThreadTree, async (_event, threadId: unknown) =>
    codexService.archiveThreadTree(assertString(threadId, 'threadId'))
  )
  ipcMain.handle(IPC.codexSetThreadName, async (_event, threadId: unknown, name: unknown) =>
    codexService.setThreadName(assertString(threadId, 'threadId'), assertString(name, 'name'))
  )
  ipcMain.handle(IPC.codexGenerateRunMetadata, async (_event, cwd: unknown, prompt: unknown) =>
    codexService.generateRunMetadata(assertString(cwd, 'cwd'), assertString(prompt, 'prompt'))
  )
}

function registerCodexTurnHandlers(
  codexService: CodexService,
  performanceTelemetryService: PerformanceTelemetryService
) {
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.codexStartTurn,
    'codex',
    async (
      _event,
      threadId: unknown,
      prompt: unknown,
      cwd?: unknown,
      model?: unknown,
      effort?: unknown,
      collaborationMode?: unknown,
      attachments?: unknown
    ) =>
      codexService.startTurn({
        threadId: assertString(threadId, 'threadId'),
        prompt: assertString(prompt, 'prompt'),
        cwd: typeof cwd === 'string' ? cwd : undefined,
        model: typeof model === 'string' ? model : undefined,
        effort: typeof effort === 'string' ? effort : undefined,
        collaborationMode: typeof collaborationMode === 'string' ? collaborationMode : undefined,
        attachments: Array.isArray(attachments)
          ? attachments.flatMap(entry => {
              if (!entry || typeof entry !== 'object') {
                return []
              }
              const record = entry as { type?: unknown; url?: unknown }
              if (record.type !== 'image' || typeof record.url !== 'string') {
                return []
              }
              return [{ type: 'image' as const, url: record.url }]
            })
          : undefined,
      })
  )

  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.codexSteerTurn,
    'codex',
    async (_event, threadId: unknown, turnId: unknown, prompt: unknown) =>
      codexService.steerTurn(
        assertString(threadId, 'threadId'),
        assertString(turnId, 'turnId'),
        assertString(prompt, 'prompt')
      )
  )
}

function registerCodexApprovalHandlers(codexService: CodexService) {
  ipcMain.handle(IPC.codexApprove, async (_event, requestId: unknown, decision: unknown) => {
    if (typeof requestId !== 'number') throw new Error('requestId must be a number')
    return codexService.respondToApproval(requestId, assertString(decision, 'decision'))
  })

  ipcMain.handle(IPC.codexDeny, async (_event, requestId: unknown) => {
    if (typeof requestId !== 'number') throw new Error('requestId must be a number')
    return codexService.respondToApproval(requestId, 'decline')
  })

  ipcMain.handle(
    IPC.codexRespondToUserInput,
    async (_event, requestId: unknown, answers: unknown) => {
      if (typeof requestId !== 'number') throw new Error('requestId must be a number')
      if (!answers || typeof answers !== 'object') throw new Error('answers must be an object')
      return codexService.respondToUserInput(
        requestId,
        answers as Record<string, { answers: string[] }>
      )
    }
  )
}

function registerCodexInterruptHandlers(codexService: CodexService) {
  ipcMain.handle(IPC.codexInterruptTurn, async (_event, threadId: unknown, turnId: unknown) => {
    // turnId is optional — the backend accepts an empty string for a thread-level interrupt
    const resolvedTurnId = typeof turnId === 'string' ? turnId : ''
    return codexService.interruptTurn(assertString(threadId, 'threadId'), resolvedTurnId)
  })

  ipcMain.handle(
    IPC.codexInterruptThreadTree,
    async (_event, threadId: unknown, turnId: unknown) => {
      const resolvedTurnId = typeof turnId === 'string' ? turnId : ''
      return codexService.interruptThreadTree(assertString(threadId, 'threadId'), resolvedTurnId)
    }
  )
}
