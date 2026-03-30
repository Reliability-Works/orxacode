import { useEffect, useMemo, useRef, useState } from 'react'
import type { CustomRunCommandInput, CustomRunCommandPreset } from './ContentTopBar'

type UseContentTopBarRunCommandsProps = {
  customRunCommands: CustomRunCommandPreset[]
  onUpsertCustomRunCommand: (input: CustomRunCommandInput) => CustomRunCommandPreset
  onRunCustomRunCommand: (command: CustomRunCommandPreset) => Promise<void>
  onDeleteCustomRunCommand: (id: string) => void
  closeOpenMenu: () => void
  closeCommitMenu: () => void
  closeTitleMenu: () => void
}

async function saveRunEditorCommand({
  runAfterSave,
  title,
  commands,
  editingId,
  onUpsertCustomRunCommand,
  onRunCustomRunCommand,
  setRunEditorError,
  setRunEditorSaving,
  setRunEditorOpen,
}: {
  runAfterSave: boolean
  title: string
  commands: string
  editingId: string | undefined
  onUpsertCustomRunCommand: (input: CustomRunCommandInput) => CustomRunCommandPreset
  onRunCustomRunCommand: (command: CustomRunCommandPreset) => Promise<void>
  setRunEditorError: (value: string | null) => void
  setRunEditorSaving: (value: boolean) => void
  setRunEditorOpen: (value: boolean) => void
}) {
  setRunEditorSaving(true)
  setRunEditorError(null)
  try {
    const saved = onUpsertCustomRunCommand({
      id: editingId,
      title,
      commands,
    })
    if (runAfterSave) {
      await onRunCustomRunCommand(saved)
    }
    setRunEditorOpen(false)
  } catch (error) {
    setRunEditorError(error instanceof Error ? error.message : String(error))
  } finally {
    setRunEditorSaving(false)
  }
}

function useRunCommandEditorState({
  onUpsertCustomRunCommand,
  onRunCustomRunCommand,
  closeOpenMenu,
  closeCommitMenu,
  closeTitleMenu,
}: Pick<
  UseContentTopBarRunCommandsProps,
  | 'onUpsertCustomRunCommand'
  | 'onRunCustomRunCommand'
  | 'closeOpenMenu'
  | 'closeCommitMenu'
  | 'closeTitleMenu'
>) {
  const runTitleInputRef = useRef<HTMLInputElement | null>(null)
  const [runEditorOpen, setRunEditorOpen] = useState(false)
  const [runEditorTitle, setRunEditorTitle] = useState('')
  const [runEditorCommands, setRunEditorCommands] = useState('')
  const [runEditorEditingId, setRunEditorEditingId] = useState<string | undefined>()
  const [runEditorError, setRunEditorError] = useState<string | null>(null)
  const [runEditorSaving, setRunEditorSaving] = useState(false)

  useEffect(() => {
    if (!runEditorOpen) return
    window.setTimeout(() => {
      runTitleInputRef.current?.focus()
      runTitleInputRef.current?.select()
    }, 0)
  }, [runEditorOpen])

  useEffect(() => {
    if (!runEditorOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setRunEditorOpen(false)
      setRunEditorError(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [runEditorOpen])

  const openRunEditor = (preset?: CustomRunCommandPreset) => {
    setRunEditorEditingId(preset?.id)
    setRunEditorTitle(preset?.title ?? '')
    setRunEditorCommands(preset?.commands ?? '')
    setRunEditorError(null)
    setRunEditorOpen(true)
    closeOpenMenu()
    closeCommitMenu()
    closeTitleMenu()
  }

  const saveRunEditor = async (runAfterSave: boolean) => {
    const title = runEditorTitle.trim()
    const commands = runEditorCommands
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join('\n')
    if (!title) {
      setRunEditorError('Name is required.')
      return
    }
    if (!commands) {
      setRunEditorError('Add at least one command.')
      return
    }
    await saveRunEditorCommand({
      runAfterSave,
      title,
      commands,
      editingId: runEditorEditingId,
      onUpsertCustomRunCommand,
      onRunCustomRunCommand,
      setRunEditorError,
      setRunEditorSaving,
      setRunEditorOpen,
    })
  }

  return {
    runTitleInputRef,
    runEditorOpen,
    runEditorTitle,
    runEditorCommands,
    runEditorError,
    runEditorSaving,
    openRunEditor,
    saveRunEditor,
    setRunEditorOpen,
    setRunEditorError,
    setRunEditorTitle,
    setRunEditorCommands,
  }
}

function useRunCommandMenuState({
  customRunCommands,
  onRunCustomRunCommand,
  onDeleteCustomRunCommand,
  openRunEditor,
  closeOpenMenu,
  closeCommitMenu,
  closeTitleMenu,
}: Pick<
  UseContentTopBarRunCommandsProps,
  | 'customRunCommands'
  | 'onRunCustomRunCommand'
  | 'onDeleteCustomRunCommand'
  | 'closeOpenMenu'
  | 'closeCommitMenu'
  | 'closeTitleMenu'
> & {
  openRunEditor: (preset?: CustomRunCommandPreset) => void
}) {
  const runMenuRootRef = useRef<HTMLDivElement | null>(null)
  const [runMenuOpen, setRunMenuOpen] = useState(false)

  const sortedRunCommands = useMemo(
    () => [...customRunCommands].sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title)),
    [customRunCommands]
  )

  useEffect(() => {
    if (!runMenuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && runMenuRootRef.current?.contains(target)) return
      setRunMenuOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [runMenuOpen])

  useEffect(() => {
    if (!runMenuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRunMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [runMenuOpen])

  const toggleRunMenu = () => {
    closeOpenMenu()
    closeCommitMenu()
    closeTitleMenu()
    if (sortedRunCommands.length === 0) {
      openRunEditor()
      return
    }
    setRunMenuOpen(current => !current)
  }

  const runCommandPreset = async (preset: CustomRunCommandPreset) => {
    setRunMenuOpen(false)
    await onRunCustomRunCommand(preset)
  }

  const deleteCommandPreset = (preset: CustomRunCommandPreset) => {
    const confirmed = window.confirm(`Delete custom run command "${preset.title}"?`)
    if (!confirmed) return
    onDeleteCustomRunCommand(preset.id)
  }

  return {
    runMenuRootRef,
    runMenuOpen,
    sortedRunCommands,
    toggleRunMenu,
    runCommandPreset,
    deleteCommandPreset,
    setRunMenuOpen,
  }
}

export function useContentTopBarRunCommands(props: UseContentTopBarRunCommandsProps) {
  const editor = useRunCommandEditorState(props)
  const menu = useRunCommandMenuState({
    customRunCommands: props.customRunCommands,
    onRunCustomRunCommand: props.onRunCustomRunCommand,
    onDeleteCustomRunCommand: props.onDeleteCustomRunCommand,
    openRunEditor: editor.openRunEditor,
    closeOpenMenu: props.closeOpenMenu,
    closeCommitMenu: props.closeCommitMenu,
    closeTitleMenu: props.closeTitleMenu,
  })

  return {
    ...editor,
    ...menu,
  }
}
