import { useCallback } from 'react'
import type { ProjectBootstrap, SessionMessageBundle } from '@shared/ipc'
import {
  deriveSessionTitleFromPrompt,
  loadOpencodeRuntimeSnapshot,
  type CreateSessionPromptOptions,
  type SelectProjectOptions,
} from './useWorkspaceState-shared'
import type { SetMessages, UnifiedRuntimeState } from './useWorkspaceState-store'
import { measurePerf } from '../lib/performance'

type ApplyRuntimeSnapshot = (
  directory: string,
  sessionID: string,
  runtime: Awaited<ReturnType<typeof loadOpencodeRuntimeSnapshot>>,
  mergePersisted?: boolean
) => SessionMessageBundle[]

type WorkspaceSessionCreationArgs = {
  activeProjectDir?: string
  setStatusLine: (status: string) => void
  getRuntimeState: () => UnifiedRuntimeState
  rememberEmptySession: (sessionID: string, directory: string) => void
  setActiveProjectDir: (directory: string | undefined) => void
  setActiveSessionID: (sessionID: string | undefined) => void
  setPendingSessionId: (sessionID: string | undefined) => void
  setMessages: SetMessages
  refreshProject: (directory: string, skipMessageLoad?: boolean) => Promise<ProjectBootstrap>
  startResponsePolling: (directory: string, sessionID: string) => void
  stopResponsePolling: () => void
  applyRuntimeSnapshot: ApplyRuntimeSnapshot
  selectProject: (directory: string, options?: SelectProjectOptions) => Promise<void>
  cleanupEmptySession: (sessionID: string | undefined) => Promise<void>
}

async function sendInitialPrompt({
  targetDirectory,
  resolvedSessionID,
  firstPrompt,
  promptOptions,
  startResponsePolling,
  applyRuntimeSnapshot,
  setStatusLine,
}: {
  targetDirectory: string
  resolvedSessionID: string
  firstPrompt: string
  promptOptions?: CreateSessionPromptOptions
  startResponsePolling: (directory: string, sessionID: string) => void
  applyRuntimeSnapshot: ApplyRuntimeSnapshot
  setStatusLine: (status: string) => void
}) {
  const supportsSelectedAgent = promptOptions?.selectedAgent
    ? promptOptions.availableAgentNames.has(promptOptions.selectedAgent)
    : false
  await measurePerf(
    {
      surface: 'session',
      metric: 'prompt.send_ack_ms',
      kind: 'span',
      unit: 'ms',
      process: 'renderer',
      component: 'workspace-session-creation',
      workspaceHash: targetDirectory,
      sessionHash: resolvedSessionID,
    },
    () =>
      window.orxa.opencode.sendPrompt({
        directory: targetDirectory,
        sessionID: resolvedSessionID,
        text: firstPrompt,
        agent: supportsSelectedAgent ? promptOptions?.selectedAgent : undefined,
        model: promptOptions?.selectedModelPayload,
        variant: promptOptions?.selectedVariant,
      })
  )
  startResponsePolling(targetDirectory, resolvedSessionID)
  void loadOpencodeRuntimeSnapshot(targetDirectory, resolvedSessionID)
    .then(runtime => {
      applyRuntimeSnapshot(targetDirectory, resolvedSessionID, runtime)
    })
    .catch(() => undefined)
  setStatusLine('Session started')
}

function resolveSessionID(
  nextSessionID: string | undefined,
  sessions: Array<{ id: string; time: { archived?: number; updated: number } }>
) {
  if (nextSessionID) return nextSessionID
  const sorted = [...sessions]
    .filter(item => !item.time.archived)
    .sort((a, b) => b.time.updated - a.time.updated)
  return sorted[0]?.id
}

export function useWorkspaceSessionCreation({
  activeProjectDir,
  setStatusLine,
  getRuntimeState,
  rememberEmptySession,
  setActiveProjectDir,
  setActiveSessionID,
  setPendingSessionId,
  setMessages,
  refreshProject,
  startResponsePolling,
  stopResponsePolling,
  applyRuntimeSnapshot,
  selectProject,
  cleanupEmptySession,
}: WorkspaceSessionCreationArgs) {
  return useCallback(
    async (
      directory?: string,
      initialPrompt?: string,
      promptOptions?: CreateSessionPromptOptions
    ): Promise<string | undefined> => {
      const targetDirectory = directory ?? activeProjectDir
      if (!targetDirectory) return undefined

      const firstPrompt = initialPrompt?.trim() ?? ''
      const title =
        firstPrompt.length > 0 ? deriveSessionTitleFromPrompt(firstPrompt) : 'OpenCode Session'

      await cleanupEmptySession(getRuntimeState().activeSessionID)
      stopResponsePolling()

      if (activeProjectDir !== targetDirectory) {
        setPendingSessionId(`creating:${targetDirectory}`)
        await selectProject(targetDirectory, { showLanding: false })
      }

      try {
        const createdSession = await measurePerf(
          {
            surface: 'session',
            metric: 'session.create_ms',
            kind: 'span',
            unit: 'ms',
            process: 'renderer',
            component: 'workspace-session-creation',
            workspaceHash: targetDirectory,
          },
          () =>
            window.orxa.opencode.createSession(
              targetDirectory,
              title,
              promptOptions?.permissionMode ?? 'ask-write'
            )
        )
        const next = await measurePerf(
          {
            surface: 'workspace',
            metric: 'workspace.refresh_ms',
            kind: 'span',
            unit: 'ms',
            process: 'renderer',
            component: 'workspace-session-creation',
            workspaceHash: targetDirectory,
          },
          () => refreshProject(targetDirectory, true)
        )
        setPendingSessionId(undefined)
        setActiveSessionID(createdSession.id)
        setActiveProjectDir(targetDirectory)
        setMessages([])

        const resolvedSessionID = resolveSessionID(createdSession.id, next.sessions)
        if (!createdSession.id && resolvedSessionID) {
          setActiveSessionID(resolvedSessionID)
        }

        if (resolvedSessionID && firstPrompt.length > 0) {
          await sendInitialPrompt({
            targetDirectory,
            resolvedSessionID,
            firstPrompt,
            promptOptions,
            startResponsePolling,
            applyRuntimeSnapshot,
            setStatusLine,
          })
        } else {
          if (resolvedSessionID) {
            setPendingSessionId(resolvedSessionID)
            rememberEmptySession(resolvedSessionID, targetDirectory)
          }
          setStatusLine('Session created')
        }
        return resolvedSessionID
      } catch (error) {
        setPendingSessionId(undefined)
        setStatusLine(error instanceof Error ? error.message : String(error))
        return undefined
      }
    },
    [
      activeProjectDir,
      applyRuntimeSnapshot,
      cleanupEmptySession,
      getRuntimeState,
      refreshProject,
      rememberEmptySession,
      selectProject,
      setActiveProjectDir,
      setActiveSessionID,
      setMessages,
      setPendingSessionId,
      setStatusLine,
      startResponsePolling,
      stopResponsePolling,
    ]
  )
}
