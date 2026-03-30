import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  AgentsDocument,
  CodexDoctorResult,
  CodexModelEntry,
  CodexUpdateResult,
  OpenCodeAgentFile,
  RawConfigDocument,
  ServerDiagnostics,
  UpdatePreferences,
} from '@shared/ipc'
import { readPersistedValue, writePersistedValue } from '../../lib/persistence'
import type { OcAgentFilenameDialog } from './opencode-agents-section'
import type {
  SettingsDrawerFeedbackSetter,
  SettingsDrawerProps,
  SettingsSection,
  UpdateCheckStatus,
} from './types'
import { UPDATE_CHECK_STATUS_KEY } from './types'

type EffectiveScope = 'project' | 'global'

export type BootstrapState = {
  rawDoc: RawConfigDocument | null
  setRawDoc: (next: RawConfigDocument | null) => void
  rawText: string
  setRawText: (next: string) => void
  globalAgentsDoc: AgentsDocument | null
  setGlobalAgentsDoc: (next: AgentsDocument | null) => void
  globalAgentsText: string
  setGlobalAgentsText: (next: string) => void
  serverDiagnostics: ServerDiagnostics | null
  setServerDiagnostics: (next: ServerDiagnostics | null) => void
  updatePreferences: UpdatePreferences
  setUpdatePreferences: (next: UpdatePreferences) => void
}

export type ClaudeSectionState = {
  claudeSettingsJson: string
  setClaudeSettingsJson: (next: string) => void
  claudeMd: string
  setClaudeMd: (next: string) => void
  claudeLoading: boolean
}

export type CodexSectionState = {
  codexConfigToml: string
  setCodexConfigToml: (next: string) => void
  codexAgentsMd: string
  setCodexAgentsMd: (next: string) => void
  codexLoading: boolean
  codexState: { status: string } | null
  codexDoctorResult: CodexDoctorResult | null
  setCodexDoctorResult: (next: CodexDoctorResult | null) => void
  codexDoctorRunning: boolean
  setCodexDoctorRunning: (next: boolean) => void
  codexUpdateResult: CodexUpdateResult | null
  setCodexUpdateResult: (next: CodexUpdateResult | null) => void
  codexUpdateRunning: boolean
  setCodexUpdateRunning: (next: boolean) => void
  codexModels: CodexModelEntry[]
  setCodexModels: Dispatch<SetStateAction<CodexModelEntry[]>>
  codexModelsLoading: boolean
  setCodexModelsLoading: (next: boolean) => void
}

export type OpenCodeAgentsState = {
  ocAgents: OpenCodeAgentFile[]
  selectedOcAgent: string | undefined
  setSelectedOcAgent: (next: string | undefined) => void
  ocAgentDraft: string
  setOcAgentDraft: (next: string) => void
  ocAgentSaving: boolean
  setOcAgentSaving: (next: boolean) => void
  ocOpenInMenu: boolean
  setOcOpenInMenu: (next: boolean | ((prev: boolean) => boolean)) => void
  loadOcAgents: () => Promise<void>
  ocFilenameDialog: OcAgentFilenameDialog | null
  setOcFilenameDialog: (next: OcAgentFilenameDialog) => void
  ocFilenameValue: string
  setOcFilenameValue: (next: string) => void
  ocFilenameError: string | null
  setOcFilenameError: (next: string | null) => void
  closeOcFilenameDialog: () => void
  openOcFilenameDialog: (dialog: OcAgentFilenameDialog, nextValue?: string) => void
  submitOcFilenameDialog: () => Promise<void>
}

function readInitialUpdateCheckStatus(): UpdateCheckStatus | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = readPersistedValue(UPDATE_CHECK_STATUS_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<UpdateCheckStatus>
    if (typeof parsed.checkedAt !== 'number' || !Number.isFinite(parsed.checkedAt)) {
      return null
    }
    if (parsed.state !== 'started' && parsed.state !== 'skipped' && parsed.state !== 'error') {
      return null
    }

    return {
      checkedAt: parsed.checkedAt,
      state: parsed.state,
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
    }
  } catch {
    return null
  }
}

export function useUpdateCheckStatus() {
  const [updateCheckStatus, setUpdateCheckStatus] = useState<UpdateCheckStatus | null>(
    () => readInitialUpdateCheckStatus()
  )

  const updateUpdateCheckStatus = useCallback((status: UpdateCheckStatus) => {
    setUpdateCheckStatus(status)
    if (typeof window === 'undefined') {
      return
    }
    try {
      writePersistedValue(UPDATE_CHECK_STATUS_KEY, JSON.stringify(status))
    } catch {
      // ignore persistence failures
    }
  }, [])

  return { updateCheckStatus, updateUpdateCheckStatus }
}

export function useEffectiveScope(scope: EffectiveScope, directory: string | undefined) {
  return useMemo<EffectiveScope>(() => {
    if (scope === 'project' && !directory) {
      return 'global'
    }
    return scope
  }, [scope, directory])
}

export function useSettingsBootstrap(
  {
    open,
    effectiveScope,
    directory,
    onReadRaw,
    onReadGlobalAgentsMd,
    onGetServerDiagnostics,
    onGetUpdatePreferences,
  }: Pick<
    SettingsDrawerProps,
    | 'open'
    | 'directory'
    | 'onReadRaw'
    | 'onReadGlobalAgentsMd'
    | 'onGetServerDiagnostics'
    | 'onGetUpdatePreferences'
  > & { effectiveScope: EffectiveScope },
  setFeedback: SettingsDrawerFeedbackSetter
): BootstrapState {
  const [rawDoc, setRawDoc] = useState<RawConfigDocument | null>(null)
  const [rawText, setRawText] = useState('')
  const [globalAgentsDoc, setGlobalAgentsDoc] = useState<AgentsDocument | null>(null)
  const [globalAgentsText, setGlobalAgentsText] = useState('')
  const [serverDiagnostics, setServerDiagnostics] = useState<ServerDiagnostics | null>(null)
  const [updatePreferences, setUpdatePreferences] = useState<UpdatePreferences>({
    autoCheckEnabled: true,
    releaseChannel: 'stable',
  })

  useEffect(() => {
    if (!open) {
      return
    }

    const load = async () => {
      const [raw, globalAgents, diagnostics, updaterPrefs] = await Promise.all([
        onReadRaw(effectiveScope, directory),
        onReadGlobalAgentsMd(),
        onGetServerDiagnostics(),
        onGetUpdatePreferences(),
      ])
      setRawDoc(raw)
      setRawText(raw.content)
      setGlobalAgentsDoc(globalAgents)
      setGlobalAgentsText(globalAgents.content)
      setUpdatePreferences(updaterPrefs)
      setServerDiagnostics(diagnostics)
      setFeedback(null)
    }

    void load().catch((error: unknown) => {
      setFeedback(error instanceof Error ? error.message : String(error))
    })
  }, [
    directory,
    effectiveScope,
    onGetServerDiagnostics,
    onGetUpdatePreferences,
    onReadGlobalAgentsMd,
    onReadRaw,
    open,
    setFeedback,
  ])

  return {
    rawDoc,
    setRawDoc,
    rawText,
    setRawText,
    globalAgentsDoc,
    setGlobalAgentsDoc,
    globalAgentsText,
    setGlobalAgentsText,
    serverDiagnostics,
    setServerDiagnostics,
    updatePreferences,
    setUpdatePreferences,
  }
}

function buildOcAgentTemplate(filename: string) {
  const baseName = filename.replace(/\.md$/, '')
  return [
    '---',
    `description: ${baseName} agent`,
    'mode: subagent',
    'model: ',
    'temperature: 0.1',
    '---',
    '',
    `# ${baseName.charAt(0).toUpperCase() + baseName.slice(1)}`,
    '',
    'Your system prompt here.',
    '',
  ].join('\n')
}

function normalizeOcAgentFilename(raw: string): { filename: string } | { error: string } {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { error: 'Filename is required.' }
  }

  const filename = trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return { error: 'Use a plain filename only (no folders).' }
  }

  return { filename }
}

export function useOpenCodeAgentsState(
  {
    open,
    section,
  }: {
    open: boolean
    section: SettingsSection
  },
  setFeedback: SettingsDrawerFeedbackSetter
): OpenCodeAgentsState {
  const [ocAgents, setOcAgents] = useState<OpenCodeAgentFile[]>([])
  const [selectedOcAgent, setSelectedOcAgent] = useState<string | undefined>()
  const [ocAgentDraft, setOcAgentDraft] = useState('')
  const [ocAgentSaving, setOcAgentSaving] = useState(false)
  const [ocOpenInMenu, setOcOpenInMenu] = useState(false)
  const [ocFilenameDialog, setOcFilenameDialog] = useState<OcAgentFilenameDialog | null>(null)
  const [ocFilenameValue, setOcFilenameValue] = useState('')
  const [ocFilenameError, setOcFilenameError] = useState<string | null>(null)

  const loadOcAgents = useCallback(async () => {
    try {
      const files = await window.orxa.opencode.listAgentFiles()
      setOcAgents(files)
      if (!selectedOcAgent && files.length > 0) {
        setSelectedOcAgent(files[0].filename)
        setOcAgentDraft(files[0].content)
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  }, [selectedOcAgent, setFeedback])

  useEffect(() => {
    if (open && section === 'opencode-agents' && ocAgents.length === 0) {
      void loadOcAgents()
    }
  }, [loadOcAgents, ocAgents.length, open, section])

  const closeOcFilenameDialog = useCallback(() => {
    setOcFilenameDialog(null)
    setOcFilenameValue('')
    setOcFilenameError(null)
  }, [])

  const openOcFilenameDialog = useCallback((dialog: OcAgentFilenameDialog, nextValue = '') => {
    setOcFilenameDialog(dialog)
    setOcFilenameValue(nextValue)
    setOcFilenameError(null)
  }, [])

  const submitOcFilenameDialog = useCallback(async () => {
    if (!ocFilenameDialog) {
      return
    }

    const parsed = normalizeOcAgentFilename(ocFilenameValue)
    if ('error' in parsed) {
      setOcFilenameError(parsed.error)
      return
    }

    const { filename } = parsed
    const exists = ocAgents.some(item => item.filename.toLowerCase() === filename.toLowerCase())
    if (exists) {
      setOcFilenameError(`Agent file ${filename} already exists.`)
      return
    }

    try {
      const content =
        ocFilenameDialog.kind === 'create'
          ? buildOcAgentTemplate(filename)
          : ocFilenameDialog.content
      await window.orxa.opencode.writeAgentFile(filename, content)
      await loadOcAgents()
      setSelectedOcAgent(filename)
      setOcAgentDraft(content)
      setFeedback(
        ocFilenameDialog.kind === 'create' ? `Created ${filename}` : `Duplicated as ${filename}`
      )
      closeOcFilenameDialog()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  }, [closeOcFilenameDialog, loadOcAgents, ocAgents, ocFilenameDialog, ocFilenameValue, setFeedback])

  return {
    ocAgents,
    selectedOcAgent,
    setSelectedOcAgent,
    ocAgentDraft,
    setOcAgentDraft,
    ocAgentSaving,
    setOcAgentSaving,
    ocOpenInMenu,
    setOcOpenInMenu,
    loadOcAgents,
    ocFilenameDialog,
    setOcFilenameDialog,
    ocFilenameValue,
    setOcFilenameValue,
    ocFilenameError,
    setOcFilenameError,
    closeOcFilenameDialog,
    openOcFilenameDialog,
    submitOcFilenameDialog,
  }
}

export function useClaudeSectionData(
  {
    open,
    section,
  }: {
    open: boolean
    section: SettingsSection
  },
  setFeedback: SettingsDrawerFeedbackSetter
): ClaudeSectionState {
  const [claudeSettingsJson, setClaudeSettingsJson] = useState('')
  const [claudeMd, setClaudeMd] = useState('')
  const [claudeLoading, setClaudeLoading] = useState(false)

  const isClaudeSection =
    section === 'claude-config' ||
    section === 'claude-permissions' ||
    section === 'claude-dirs' ||
    section === 'claude-personalization'

  useEffect(() => {
    if (!open || !isClaudeSection) {
      return
    }

    setClaudeLoading(true)
    void Promise.all([
      window.orxa.app.readTextFile('~/.claude/settings.json'),
      window.orxa.app.readTextFile('~/.claude/CLAUDE.md'),
    ])
      .then(([settingsJson, claudeMdContent]) => {
        setClaudeSettingsJson(settingsJson)
        setClaudeMd(claudeMdContent)
      })
      .catch((error: unknown) => {
        setFeedback(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setClaudeLoading(false))
  }, [isClaudeSection, open, setFeedback])

  return { claudeSettingsJson, setClaudeSettingsJson, claudeMd, setClaudeMd, claudeLoading }
}

export function useCodexSectionData(
  {
    open,
    section,
  }: {
    open: boolean
    section: SettingsSection
  },
  setFeedback: SettingsDrawerFeedbackSetter
): CodexSectionState {
  const [codexConfigToml, setCodexConfigToml] = useState('')
  const [codexAgentsMd, setCodexAgentsMd] = useState('')
  const [codexLoading, setCodexLoading] = useState(false)
  const [codexState, setCodexState] = useState<{ status: string } | null>(null)
  const [codexDoctorResult, setCodexDoctorResult] = useState<CodexDoctorResult | null>(null)
  const [codexDoctorRunning, setCodexDoctorRunning] = useState(false)
  const [codexUpdateResult, setCodexUpdateResult] = useState<CodexUpdateResult | null>(null)
  const [codexUpdateRunning, setCodexUpdateRunning] = useState(false)
  const [codexModels, setCodexModels] = useState<CodexModelEntry[]>([])
  const [codexModelsLoading, setCodexModelsLoading] = useState(false)

  const isCodexSection =
    section === 'codex-general' ||
    section === 'codex-models' ||
    section === 'codex-access' ||
    section === 'codex-config' ||
    section === 'codex-personalization' ||
    section === 'codex-dirs'

  useEffect(() => {
    if (!open || !isCodexSection) {
      return
    }

    setCodexLoading(true)
    void Promise.all([
      window.orxa.app.readTextFile('~/.codex/config.toml'),
      window.orxa.app.readTextFile('~/.codex/AGENTS.md'),
      window.orxa.codex.getState(),
      window.orxa.codex.listModels(),
    ])
      .then(([configToml, agentsMd, state, models]) => {
        setCodexConfigToml(configToml)
        setCodexAgentsMd(agentsMd)
        setCodexState(state)
        setCodexModels(models)
      })
      .catch((error: unknown) => {
        setFeedback(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setCodexLoading(false))
  }, [isCodexSection, open, setFeedback])

  return {
    codexConfigToml,
    setCodexConfigToml,
    codexAgentsMd,
    setCodexAgentsMd,
    codexLoading,
    codexState,
    codexDoctorResult,
    setCodexDoctorResult,
    codexDoctorRunning,
    setCodexDoctorRunning,
    codexUpdateResult,
    setCodexUpdateResult,
    codexUpdateRunning,
    setCodexUpdateRunning,
    codexModels,
    setCodexModels,
    codexModelsLoading,
    setCodexModelsLoading,
  }
}
