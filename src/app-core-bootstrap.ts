import { useCallback, useMemo } from 'react'
import { parse as parseJsonc } from 'jsonc-parser'
import type { Agent, ProviderListResponse } from '@opencode-ai/sdk/v2/client'
import type {
  OpenCodeAgentFile,
  ProjectListItem,
  ProjectBootstrap,
  RuntimeDependencyReport,
  RuntimeProfile,
  RuntimeState,
} from '@shared/ipc'
import { useAppShellStartupFlow } from './hooks/useAppShellStartupFlow'
import { listModelOptionsFromConfigReferences, type ModelOption } from './lib/models'

const STARTUP_STEP_TIMEOUT_MS = 12_000

type AppCoreBootstrapContext = {
  activeProjectDir: string | undefined
  cleanupPersistedEmptySessions: () => Promise<void> | void
  setRuntime: (value: RuntimeState) => void
  setProfiles: (value: RuntimeProfile[]) => void
  setProjects: (value: ProjectListItem[]) => void
  setConfigModelOptions: (value: ModelOption[]) => void
  setGlobalProviders: (value: ProviderListResponse) => void
  setGlobalAgents: (value: Agent[]) => void
  setOpencodeAgentFiles: (value: OpenCodeAgentFile[]) => void
  setDependencyReport: (value: RuntimeDependencyReport | null) => void
  setDependencyModalOpen: (value: boolean) => void
  setStatusLine: (value: string) => void
  setActiveProjectDir: (value: string | undefined) => void
  setProjectData: (value: ProjectBootstrap | null) => void
  setActiveSessionID: (value: string | undefined) => void
  setMessages: (value: []) => void
  setProjectDataForDirectory: (directory: string, data: ProjectBootstrap) => void
  setProjectCacheVersion: (value: (current: number) => number) => void
  syncBrowserSnapshot: () => Promise<void>
}

function reportBootstrapError(error: unknown, setStatusLine: AppCoreBootstrapContext['setStatusLine']) {
  setStatusLine(error instanceof Error ? error.message : String(error))
}

function useRuntimeRefresh(context: AppCoreBootstrapContext) {
  const { setProfiles, setRuntime } = context

  return useCallback(async () => {
    const [nextRuntime, nextProfiles] = await Promise.all([
      window.orxa.runtime.getState(),
      window.orxa.runtime.listProfiles(),
    ])
    setRuntime(nextRuntime)
    setProfiles(nextProfiles)
  }, [setProfiles, setRuntime])
}

function useConfigRefresh(context: AppCoreBootstrapContext) {
  const { setConfigModelOptions } = context

  return useCallback(async () => {
    try {
      const globalDoc = await window.orxa.opencode.readRawConfig('global')
      const parsed = parseJsonc(globalDoc.content) as unknown
      setConfigModelOptions(listModelOptionsFromConfigReferences(parsed))
    } catch {
      setConfigModelOptions([])
    }
  }, [setConfigModelOptions])
}

function useProviderRefresh(context: AppCoreBootstrapContext) {
  const { setGlobalProviders } = context

  return useCallback(async () => {
    try {
      setGlobalProviders(await window.orxa.opencode.listProviders())
    } catch {
      setGlobalProviders({ all: [], connected: [], default: {} })
    }
  }, [setGlobalProviders])
}

function useAgentRefresh(context: AppCoreBootstrapContext) {
  const { setGlobalAgents } = context

  return useCallback(async () => {
    try {
      setGlobalAgents(await window.orxa.opencode.listAgents())
    } catch {
      setGlobalAgents([])
    }
  }, [setGlobalAgents])
}

function useAgentFilesRefresh(context: AppCoreBootstrapContext) {
  const { setOpencodeAgentFiles } = context

  return useCallback(async () => {
    try {
      setOpencodeAgentFiles(await window.orxa.opencode.listAgentFiles())
    } catch {
      setOpencodeAgentFiles([])
    }
  }, [setOpencodeAgentFiles])
}

function useRuntimeDependenciesRefresh(context: AppCoreBootstrapContext) {
  const { setDependencyModalOpen, setDependencyReport } = context

  return useCallback(async () => {
    try {
      const report = await window.orxa.opencode.checkDependencies()
      setDependencyReport(report)
      setDependencyModalOpen(report.missingAny)
    } catch {
      setDependencyReport(null)
    }
  }, [setDependencyModalOpen, setDependencyReport])
}

function useProjectBootstrap(context: AppCoreBootstrapContext) {
  const {
    activeProjectDir,
    setActiveProjectDir,
    setActiveSessionID,
    setMessages,
    setProjectCacheVersion,
    setProjectData,
    setProjectDataForDirectory,
    setProjects,
    setRuntime,
    setStatusLine,
  } = context

  return useCallback(async () => {
    try {
      const result = await window.orxa.opencode.bootstrap()
      setProjects(result.projects)
      setRuntime(result.runtime)
      if (activeProjectDir && !result.projects.some(item => item.worktree === activeProjectDir)) {
        setStatusLine(`Workspace directory is no longer accessible: ${activeProjectDir}`)
        setActiveProjectDir(undefined)
        setProjectData(null)
        setActiveSessionID(undefined)
        setMessages([])
      }
      for (const project of result.projects) {
        if (project.worktree === activeProjectDir) {
          continue
        }
        window.orxa.opencode
          .selectProject(project.worktree)
          .then(data => {
            setProjectDataForDirectory(project.worktree, data)
            setProjectCacheVersion(version => version + 1)
          })
          .catch(() => undefined)
      }
    } catch (error) {
      reportBootstrapError(error, setStatusLine)
    }
  }, [
    activeProjectDir,
    setActiveProjectDir,
    setActiveSessionID,
    setMessages,
    setProjectCacheVersion,
    setProjectData,
    setProjectDataForDirectory,
    setProjects,
    setRuntime,
    setStatusLine,
  ])
}

function useStartupState(args: {
  bootstrap: () => Promise<void>
  cleanupPersistedEmptySessions: AppCoreBootstrapContext['cleanupPersistedEmptySessions']
  refreshAgentFiles: () => Promise<void>
  refreshConfigModels: () => Promise<void>
  refreshGlobalAgents: () => Promise<void>
  refreshGlobalProviders: () => Promise<void>
  refreshProfiles: () => Promise<void>
  refreshRuntimeDependencies: () => Promise<void>
  setStatusLine: AppCoreBootstrapContext['setStatusLine']
  syncBrowserSnapshot: AppCoreBootstrapContext['syncBrowserSnapshot']
}) {
  const {
    bootstrap,
    cleanupPersistedEmptySessions,
    refreshAgentFiles,
    refreshConfigModels,
    refreshGlobalAgents,
    refreshGlobalProviders,
    refreshProfiles,
    refreshRuntimeDependencies,
    setStatusLine,
    syncBrowserSnapshot,
  } = args

  const startupSteps = useMemo(
    () => [
      { message: 'Loading runtime profiles…', action: refreshProfiles },
      { message: 'Cleaning temporary sessions…', action: async () => void (await cleanupPersistedEmptySessions()) },
      { message: 'Bootstrapping workspaces…', action: bootstrap },
      { message: 'Loading model references…', action: refreshConfigModels },
      { message: 'Loading provider registry…', action: refreshGlobalProviders },
      { message: 'Loading agent registry…', action: refreshGlobalAgents },
      { message: 'Loading agent files…', action: refreshAgentFiles },
      { message: 'Checking runtime dependencies…', action: refreshRuntimeDependencies },
      { message: 'Syncing browser state…', action: syncBrowserSnapshot },
    ],
    [
      bootstrap,
      cleanupPersistedEmptySessions,
      refreshAgentFiles,
      refreshConfigModels,
      refreshGlobalAgents,
      refreshGlobalProviders,
      refreshProfiles,
      refreshRuntimeDependencies,
      syncBrowserSnapshot,
    ]
  )

  return useAppShellStartupFlow({
    initialMessage: 'Initializing Orxa Code…',
    totalSteps: startupSteps.length,
    stepTimeoutMs: STARTUP_STEP_TIMEOUT_MS,
    steps: startupSteps,
    onStepError: error => reportBootstrapError(error, setStatusLine),
  })
}

export function useAppCoreBootstrap(context: AppCoreBootstrapContext) {
  const refreshProfiles = useRuntimeRefresh(context)
  const refreshConfigModels = useConfigRefresh(context)
  const refreshGlobalProviders = useProviderRefresh(context)
  const refreshGlobalAgents = useAgentRefresh(context)
  const refreshAgentFiles = useAgentFilesRefresh(context)
  const refreshRuntimeDependencies = useRuntimeDependenciesRefresh(context)
  const bootstrap = useProjectBootstrap(context)
  const startup = useStartupState({
    bootstrap,
    cleanupPersistedEmptySessions: context.cleanupPersistedEmptySessions,
    refreshAgentFiles,
    refreshConfigModels,
    refreshGlobalAgents,
    refreshGlobalProviders,
    refreshProfiles,
    refreshRuntimeDependencies,
    setStatusLine: context.setStatusLine,
    syncBrowserSnapshot: context.syncBrowserSnapshot,
  })

  return {
    refreshProfiles,
    refreshConfigModels,
    refreshGlobalProviders,
    refreshGlobalAgents,
    refreshAgentFiles,
    refreshRuntimeDependencies,
    bootstrap,
    startupState: startup.startupState,
    startupProgressPercent: startup.startupProgressPercent,
  }
}
