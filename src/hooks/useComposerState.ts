import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type Attachment = {
  url: string
  filename: string
  mime: string
  path: string
}

type ComposerSession = {
  id: string
  title?: string
}

type SlashCommand = {
  name: string
  description?: string
}

export type ModelPayload = {
  providerID: string
  modelID: string
}

export type SendPromptInput = {
  textOverride?: string
  attachmentOverride?: Attachment[]
  systemAddendum?: string
  promptSource?: 'user' | 'job' | 'machine'
  tools?: Record<string, boolean>
}

type UseComposerStateOptions = {
  availableSlashCommands: SlashCommand[]
  refreshMessages: () => Promise<unknown>
  refreshProject: (directory: string) => Promise<unknown>
  sessions: ComposerSession[]
  selectedAgent?: string
  availableAgentNames: Set<string>
  setStatusLine: (status: string) => void
  shouldAutoRenameSessionTitle: (title: string | undefined) => boolean
  deriveSessionTitleFromPrompt: (prompt: string, maxLength?: number) => string
  startResponsePolling: (directory: string, sessionID: string) => void
  stopResponsePolling: () => void
  clearPendingSession: () => void
  onSessionAbortRequested?: (directory: string, sessionID: string) => void
  onPromptAccepted?: (payload: {
    directory: string
    sessionID: string
    text: string
    promptSource: 'user' | 'job' | 'machine'
  }) => void
}

// Per-workspace composer text cache (survives workspace switches)
const composerByWorkspace = new Map<string, string>()

function useComposerWorkspaceText(activeProjectDir: string | null) {
  const [composer, setComposerRaw] = useState(() =>
    activeProjectDir ? (composerByWorkspace.get(activeProjectDir) ?? '') : ''
  )
  const prevProjectDirRef = useRef(activeProjectDir)

  // Sync composer text when switching workspaces
  useEffect(() => {
    const prev = prevProjectDirRef.current
    if (prev === activeProjectDir) return
    // Save current text for the previous workspace (including empty string)
    if (prev) {
      composerByWorkspace.set(prev, composer)
    }
    // Restore text for the new workspace
    prevProjectDirRef.current = activeProjectDir
    setComposerRaw(activeProjectDir ? (composerByWorkspace.get(activeProjectDir) ?? '') : '')
  }, [activeProjectDir, composer])

  const setComposer = useCallback(
    (value: string | ((prev: string) => string)) => {
      setComposerRaw(prev => {
        const next = typeof value === 'function' ? value(prev) : value
        if (activeProjectDir) {
          composerByWorkspace.set(activeProjectDir, next)
        }
        return next
      })
    },
    [activeProjectDir]
  )

  return { composer, setComposer }
}

function useComposerSlashMenu(
  availableSlashCommands: SlashCommand[],
  setComposer: (value: string | ((prev: string) => string)) => void
) {
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)

  const filteredSlashCommands = useMemo(() => {
    const query = slashQuery.toLowerCase()
    if (!query) {
      return availableSlashCommands
    }
    return availableSlashCommands.filter(
      cmd =>
        cmd.name.toLowerCase().includes(query) ||
        (cmd.description?.toLowerCase().includes(query) ?? false)
    )
  }, [availableSlashCommands, slashQuery])

  const filteredSlashCommandsRef = useRef(filteredSlashCommands)
  useEffect(() => {
    filteredSlashCommandsRef.current = filteredSlashCommands
  }, [filteredSlashCommands])

  const slashSelectedIndexRef = useRef(slashSelectedIndex)
  useEffect(() => {
    slashSelectedIndexRef.current = slashSelectedIndex
  }, [slashSelectedIndex])

  const handleComposerChange = useCallback(
    (value: string) => {
      setComposer(value)

      const lines = value.split('\n')
      const currentLine = lines[lines.length - 1]

      if (currentLine.startsWith('/') && !currentLine.includes(' ')) {
        const query = currentLine.slice(1)
        setSlashQuery(query)
        setSlashMenuOpen(true)
        setSlashSelectedIndex(0)
      } else {
        setSlashMenuOpen(open => (open ? false : open))
      }
    },
    [setComposer]
  )

  const insertSlashCommand = useCallback(
    (commandName: string) => {
      setComposer(prev => {
        const lines = prev.split('\n')
        lines[lines.length - 1] = `/${commandName} `
        return lines.join('\n')
      })
      setSlashMenuOpen(false)
      setSlashQuery('')
    },
    [setComposer]
  )

  const handleSlashKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const commands = filteredSlashCommandsRef.current
        setSlashSelectedIndex(current => (current < commands.length - 1 ? current + 1 : current))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashSelectedIndex(current => (current > 0 ? current - 1 : 0))
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const commands = filteredSlashCommandsRef.current
        const selectedIdx = slashSelectedIndexRef.current
        const command = commands[selectedIdx]
        if (command) {
          insertSlashCommand(command.name)
        }
      } else if (event.key === 'Escape') {
        setSlashMenuOpen(false)
      }
    },
    [insertSlashCommand]
  )

  return {
    slashMenuOpen,
    setSlashMenuOpen,
    slashQuery,
    filteredSlashCommands,
    slashSelectedIndex,
    setSlashSelectedIndex,
    handleComposerChange,
    insertSlashCommand,
    handleSlashKeyDown,
  }
}

function buildSelectedModelPayload(selectedModel?: string) {
  if (!selectedModel) {
    return undefined
  }
  const [providerID, ...modelParts] = selectedModel.split('/')
  const modelID = modelParts.join('/')
  if (!providerID || !modelID) {
    return undefined
  }
  return { providerID, modelID }
}

function useComposerAttachments(setStatusLine: (status: string) => void) {
  const [composerAttachments, setComposerAttachments] = useState<Attachment[]>([])

  const addComposerAttachments = useCallback((attachments: Attachment[]) => {
    if (attachments.length === 0) {
      return
    }
    setComposerAttachments(current => {
      const seen = new Set(current.map(item => item.url))
      const next: Attachment[] = []
      for (const attachment of attachments) {
        if (!attachment.url || seen.has(attachment.url)) {
          continue
        }
        seen.add(attachment.url)
        next.push(attachment)
      }
      if (next.length === 0) {
        return current
      }
      return [...current, ...next]
    })
  }, [])

  const pickImageAttachment = useCallback(async () => {
    try {
      const selection = await window.orxa.opencode.pickImage()
      if (!selection) {
        return
      }
      addComposerAttachments([selection])
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
    }
  }, [addComposerAttachments, setStatusLine])

  const removeAttachment = useCallback((url: string) => {
    setComposerAttachments(current => current.filter(item => item.url !== url))
  }, [])

  return {
    composerAttachments,
    setComposerAttachments,
    addComposerAttachments,
    pickImageAttachment,
    removeAttachment,
  }
}

async function abortComposerActiveSession(
  activeProjectDir: string,
  activeSessionID: string,
  options: UseComposerStateOptions
) {
  options.onSessionAbortRequested?.(activeProjectDir, activeSessionID)
  await window.orxa.opencode.abortSession(activeProjectDir, activeSessionID)
  options.setStatusLine('Stopping session...')
  void options.refreshProject(activeProjectDir).catch(() => undefined)
  void options.refreshMessages().catch(() => undefined)
}

async function submitComposerPrompt(
  activeProjectDir: string,
  activeSessionID: string,
  composer: string,
  composerAttachments: Attachment[],
  options: UseComposerStateOptions,
  selectedModel: string | undefined,
  selectedVariant: string | undefined,
  setComposer: (value: string | ((prev: string) => string)) => void,
  setComposerAttachments: (value: Attachment[]) => void,
  setIsSendingPrompt: (value: boolean) => void,
  sendingPromptRef: { current: boolean },
  lastSendRef: { current: { token: string; at: number } | null },
  selectedAgent?: string
) {
  if (sendingPromptRef.current) {
    return
  }

  const promptInput = composer.trim()
  const text = promptInput
  const effectiveAttachments = composerAttachments
  if (!text && effectiveAttachments.length === 0) {
    return
  }

  const normalizedSystemAddendum = ''
  const promptSource: 'user' | 'job' | 'machine' = 'user'
  const toolsKey = ''
  const sendToken = `${activeProjectDir}:${activeSessionID}:${text}:${effectiveAttachments.map(item => item.url).join(',')}:${normalizedSystemAddendum}:${promptSource}:${toolsKey}`
  if (lastSendRef.current && lastSendRef.current.token === sendToken && Date.now() - lastSendRef.current.at < 6_000) {
    return
  }
  lastSendRef.current = { token: sendToken, at: Date.now() }

  const capturedAttachments = [...effectiveAttachments]
  setComposer('')
  setComposerAttachments([])

  const supportsSelectedAgent = selectedAgent ? options.availableAgentNames.has(selectedAgent) : false
  const activeSession = options.sessions.find(item => item.id === activeSessionID)
  const shouldAutoTitle = text.length > 0 && options.shouldAutoRenameSessionTitle(activeSession?.title)

  try {
    sendingPromptRef.current = true
    setIsSendingPrompt(true)
    options.setStatusLine('Sending prompt...')
    options.stopResponsePolling()
    if (shouldAutoTitle) {
      const generatedTitle = options.deriveSessionTitleFromPrompt(text)
      await window.orxa.opencode.renameSession(activeProjectDir, activeSessionID, generatedTitle)
      await options.refreshProject(activeProjectDir)
    }

    await window.orxa.opencode.sendPrompt({
      directory: activeProjectDir,
      sessionID: activeSessionID,
      text,
      system: undefined,
      promptSource,
      tools: undefined,
      attachments: capturedAttachments.map((attachment, index) => ({
        url: attachment.url,
        mime: attachment.mime,
        filename: `image${index + 1}`,
      })),
      agent: supportsSelectedAgent ? selectedAgent : undefined,
      model: buildSelectedModelPayload(selectedModel),
      variant: selectedVariant,
    })

    options.clearPendingSession()
    options.setStatusLine(shouldAutoTitle ? 'Prompt sent and session titled' : 'Prompt sent')
    options.onPromptAccepted?.({
      directory: activeProjectDir,
      sessionID: activeSessionID,
      text,
      promptSource,
    })
    options.startResponsePolling(activeProjectDir, activeSessionID)
    void options.refreshMessages()
    if (shouldAutoTitle) {
      void options.refreshProject(activeProjectDir).catch(() => undefined)
    }
  } catch (error) {
    setComposer(text)
    setComposerAttachments(capturedAttachments)
    options.setStatusLine(error instanceof Error ? error.message : String(error))
  } finally {
    sendingPromptRef.current = false
    setIsSendingPrompt(false)
  }
}

function useComposerPromptActions(
  activeProjectDir: string | null,
  activeSessionID: string | null,
  setComposer: (value: string | ((prev: string) => string)) => void,
  options: UseComposerStateOptions,
  composer: string,
  composerAttachments: Attachment[],
  setComposerAttachments: (value: Attachment[]) => void
) {
  const [isSendingPrompt, setIsSendingPrompt] = useState(false)
  const sendingPromptRef = useRef(false)
  const lastSendRef = useRef<{ token: string; at: number } | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | undefined>()
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>()

  const sendPrompt = useCallback(
    async (input?: string | SendPromptInput) => {
      if (!activeProjectDir || !activeSessionID) {
        options.setStatusLine('Select a workspace and session first')
        return
      }
      const promptInput: SendPromptInput =
        typeof input === 'string' ? { systemAddendum: input } : (input ?? {})
      await submitComposerPrompt(
        activeProjectDir,
        activeSessionID,
        promptInput.textOverride ?? composer,
        promptInput.attachmentOverride ?? composerAttachments,
        options,
        selectedModel,
        selectedVariant,
        setComposer,
        setComposerAttachments,
        setIsSendingPrompt,
        sendingPromptRef,
        lastSendRef,
        options.selectedAgent
      )
    },
    [
      activeProjectDir,
      activeSessionID,
      composer,
      composerAttachments,
      options,
      selectedVariant,
      selectedModel,
      setComposer,
      setComposerAttachments,
    ]
  )

  const abortActiveSession = useCallback(async () => {
    if (!activeProjectDir || !activeSessionID) {
      return
    }
    try {
      await abortComposerActiveSession(activeProjectDir, activeSessionID, options)
    } catch (error) {
      options.setStatusLine(error instanceof Error ? error.message : String(error))
    }
  }, [activeProjectDir, activeSessionID, options])

  return {
    isSendingPrompt,
    selectedModel,
    setSelectedModel,
    selectedVariant,
    setSelectedVariant,
    selectedModelPayload: buildSelectedModelPayload(selectedModel),
    sendPrompt,
    abortActiveSession,
  }
}

export function useComposerState(
  activeProjectDir: string | null,
  activeSessionID: string | null,
  options: UseComposerStateOptions
) {
  const { composer, setComposer } = useComposerWorkspaceText(activeProjectDir)
  const slashMenu = useComposerSlashMenu(options.availableSlashCommands, setComposer)
  const {
    composerAttachments,
    setComposerAttachments,
    addComposerAttachments,
    pickImageAttachment,
    removeAttachment,
  } = useComposerAttachments(options.setStatusLine)
  const promptActions = useComposerPromptActions(
    activeProjectDir,
    activeSessionID,
    setComposer,
    options,
    composer,
    composerAttachments,
    setComposerAttachments
  )

  return {
    composer,
    setComposer,
    composerAttachments,
    setComposerAttachments,
    addComposerAttachments,
    pickImageAttachment,
    removeAttachment,
    ...promptActions,
    ...slashMenu,
  }
}
