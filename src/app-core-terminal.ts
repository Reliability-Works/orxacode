import {
  useCallback,
  useEffect,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { CustomRunCommandInput, CustomRunCommandPreset } from './components/ContentTopBar'

const DEFAULT_TERMINAL_TITLE_PREFIX = 'Tab'
const MIN_TERMINAL_PANEL_HEIGHT = 120
const MAX_TERMINAL_PANEL_HEIGHT = 420

export type TerminalTab = { id: string; label: string }

type TerminalResizeState = {
  startY: number
  startHeight: number
}

type AppCoreTerminalContext = {
  activeProjectDir: string | undefined
  activeTerminalId: string | undefined
  canShowIntegratedTerminal: boolean
  projectDirectory: string | undefined
  terminalOpen: boolean
  terminalPanelHeight: number
  terminalTabs: TerminalTab[]
  terminalResizeStateRef: MutableRefObject<TerminalResizeState | null>
  setActiveTerminalId: Dispatch<SetStateAction<string | undefined>>
  setTerminalOpen: Dispatch<SetStateAction<boolean>>
  setTerminalPanelHeight: Dispatch<SetStateAction<number>>
  setTerminalTabs: Dispatch<SetStateAction<TerminalTab[]>>
  setCustomRunCommands: Dispatch<SetStateAction<CustomRunCommandPreset[]>>
  setStatusLine: (value: string) => void
}

function splitCommandLines(commands: string) {
  return commands
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

function useCreateTerminalTab(context: AppCoreTerminalContext) {
  const {
    activeProjectDir,
    projectDirectory,
    setActiveTerminalId,
    setTerminalOpen,
    setTerminalTabs,
    terminalTabs,
  } = context

  return useCallback(async (): Promise<string> => {
    if (!activeProjectDir) {
      throw new Error('No active workspace selected.')
    }
    const cwd = projectDirectory ?? activeProjectDir
    const tabNum = terminalTabs.length + 1
    const pty = await window.orxa.terminal.create(
      activeProjectDir,
      cwd,
      `${DEFAULT_TERMINAL_TITLE_PREFIX} ${tabNum}`
    )
    const newTab = { id: pty.id, label: `${DEFAULT_TERMINAL_TITLE_PREFIX} ${tabNum}` }
    setTerminalTabs(prev => [...prev, newTab])
    setActiveTerminalId(pty.id)
    setTerminalOpen(true)
    return pty.id
  }, [
    activeProjectDir,
    projectDirectory,
    setActiveTerminalId,
    setTerminalOpen,
    setTerminalTabs,
    terminalTabs.length,
  ])
}

function useTerminalVisibility(
  context: AppCoreTerminalContext,
  createTerminalTab: () => Promise<string>
) {
  const {
    activeProjectDir,
    canShowIntegratedTerminal,
    setStatusLine,
    setTerminalOpen,
    terminalOpen,
    terminalTabs,
  } = context

  const createTerminal = useCallback(async () => {
    try {
      await createTerminalTab()
      setStatusLine('Terminal created')
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
    }
  }, [createTerminalTab, setStatusLine])

  const toggleTerminal = useCallback(async () => {
    if (!canShowIntegratedTerminal) {
      return
    }
    if (terminalOpen) {
      setTerminalOpen(false)
      return
    }
    if (!activeProjectDir) {
      return
    }
    if (terminalTabs.length === 0) {
      await createTerminal()
      return
    }
    setTerminalOpen(true)
  }, [
    activeProjectDir,
    canShowIntegratedTerminal,
    createTerminal,
    setTerminalOpen,
    terminalOpen,
    terminalTabs.length,
  ])

  return { createTerminal, toggleTerminal }
}

function useTerminalResize(context: AppCoreTerminalContext) {
  const { setTerminalPanelHeight, terminalPanelHeight, terminalResizeStateRef } = context

  const handleTerminalResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      terminalResizeStateRef.current = {
        startY: event.clientY,
        startHeight: terminalPanelHeight,
      }
    },
    [terminalPanelHeight, terminalResizeStateRef]
  )

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const state = terminalResizeStateRef.current
      if (!state) {
        return
      }
      const deltaY = state.startY - event.clientY
      const nextHeight = Math.min(
        MAX_TERMINAL_PANEL_HEIGHT,
        Math.max(MIN_TERMINAL_PANEL_HEIGHT, state.startHeight + deltaY)
      )
      setTerminalPanelHeight(nextHeight)
    }

    const handleMouseUp = () => {
      terminalResizeStateRef.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [setTerminalPanelHeight, terminalResizeStateRef])

  return handleTerminalResizeStart
}

function useCustomRunCommands(
  context: AppCoreTerminalContext,
  createTerminalTab: () => Promise<string>
) {
  const {
    activeProjectDir,
    activeTerminalId,
    setActiveTerminalId,
    setCustomRunCommands,
    setStatusLine,
    setTerminalOpen,
    terminalTabs,
  } = context

  const upsertCustomRunCommand = useCallback(
    (input: CustomRunCommandInput): CustomRunCommandPreset => {
      const title = input.title.trim()
      const commands = input.commands.replace(/\r\n/g, '\n').trim()
      if (!title) {
        throw new Error('Name is required.')
      }
      if (!commands) {
        throw new Error('Add at least one command.')
      }
      const normalizedID = input.id?.trim()
      const next: CustomRunCommandPreset = {
        id:
          normalizedID && normalizedID.length > 0
            ? normalizedID
            : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        commands,
        updatedAt: Date.now(),
      }
      setCustomRunCommands(current => {
        const remaining = current.filter(item => item.id !== next.id)
        return [next, ...remaining].sort((a, b) => b.updatedAt - a.updatedAt)
      })
      return next
    },
    [setCustomRunCommands]
  )

  const runCustomRunCommand = useCallback(
    async (preset: CustomRunCommandPreset) => {
      if (!activeProjectDir) {
        setStatusLine('Select a workspace before running commands.')
        return
      }
      const commandLines = splitCommandLines(preset.commands)
      if (commandLines.length === 0) {
        setStatusLine(`No commands found for ${preset.title}.`)
        return
      }

      let targetPtyID = activeTerminalId ?? terminalTabs[0]?.id
      try {
        if (!targetPtyID) {
          targetPtyID = await createTerminalTab()
        }
        if (activeTerminalId !== targetPtyID) {
          setActiveTerminalId(targetPtyID)
        }
        setTerminalOpen(true)
        await window.orxa.terminal.connect(activeProjectDir, targetPtyID)
        for (const command of commandLines) {
          await window.orxa.terminal.write(activeProjectDir, targetPtyID, `${command}\n`)
        }
        setStatusLine(
          `Ran ${commandLines.length} command${commandLines.length === 1 ? '' : 's'} from ${preset.title}.`
        )
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [
      activeProjectDir,
      activeTerminalId,
      createTerminalTab,
      setActiveTerminalId,
      setStatusLine,
      setTerminalOpen,
      terminalTabs,
    ]
  )

  const deleteCustomRunCommand = useCallback(
    (id: string) => {
      setCustomRunCommands(current => current.filter(item => item.id !== id))
      setStatusLine('Custom run command deleted.')
    },
    [setCustomRunCommands, setStatusLine]
  )

  return { upsertCustomRunCommand, runCustomRunCommand, deleteCustomRunCommand }
}

function useCloseTerminalTab(context: AppCoreTerminalContext) {
  const {
    activeProjectDir,
    activeTerminalId,
    setActiveTerminalId,
    setTerminalOpen,
    setTerminalTabs,
  } = context

  return useCallback(
    async (ptyId: string) => {
      if (!activeProjectDir) {
        return
      }
      await window.orxa.terminal.close(activeProjectDir, ptyId).catch(() => undefined)
      setTerminalTabs(prev => {
        const remaining = prev.filter(tab => tab.id !== ptyId)
        if (activeTerminalId === ptyId) {
          setActiveTerminalId(remaining[remaining.length - 1]?.id)
        }
        if (remaining.length === 0) {
          setTerminalOpen(false)
        }
        return remaining
      })
    },
    [activeProjectDir, activeTerminalId, setActiveTerminalId, setTerminalOpen, setTerminalTabs]
  )
}

export function useAppCoreTerminal(context: AppCoreTerminalContext) {
  const createTerminalTab = useCreateTerminalTab(context)
  const { createTerminal, toggleTerminal } = useTerminalVisibility(context, createTerminalTab)
  const handleTerminalResizeStart = useTerminalResize(context)
  const { upsertCustomRunCommand, runCustomRunCommand, deleteCustomRunCommand } =
    useCustomRunCommands(context, createTerminalTab)
  const closeTerminalTab = useCloseTerminalTab(context)

  return {
    createTerminalTab,
    createTerminal,
    toggleTerminal,
    handleTerminalResizeStart,
    upsertCustomRunCommand,
    runCustomRunCommand,
    deleteCustomRunCommand,
    closeTerminalTab,
  }
}
