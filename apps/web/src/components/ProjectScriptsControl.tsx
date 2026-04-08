import type {
  ProjectScript,
  ProjectScriptIcon,
  ResolvedKeybindingsConfig,
} from '@orxa-code/contracts'
import React, { type FormEvent, type KeyboardEvent, useCallback, useMemo, useState } from 'react'

import {
  decodeProjectScriptKeybindingRule,
  keybindingValueForCommand,
} from '~/lib/projectScriptKeybindings'
import { isMacPlatform } from '~/lib/utils'
import {
  commandForProjectScript,
  nextProjectScriptId,
  primaryProjectScript,
} from '~/projectScripts'
import { ProjectScriptsPrimaryControls } from './ProjectScriptsControl.ui'
import { ProjectScriptsDeleteDialog, ProjectScriptsDialog } from './ProjectScriptsControl.dialog'

const MODIFIER_SHORTCUT_KEYS = new Set(['meta', 'control', 'ctrl', 'shift', 'alt', 'option'])
const SPECIAL_SHORTCUT_KEY_TOKENS: Record<string, string> = {
  ' ': 'space',
  escape: 'esc',
  arrowup: 'arrowup',
  arrowdown: 'arrowdown',
  arrowleft: 'arrowleft',
  arrowright: 'arrowright',
  enter: 'enter',
  tab: 'tab',
  backspace: 'backspace',
  delete: 'delete',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
}

const DROPDOWN_ITEM_CLASS_NAME =
  'data-highlighted:bg-transparent data-highlighted:text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground data-highlighted:hover:bg-accent data-highlighted:hover:text-accent-foreground data-highlighted:focus-visible:bg-accent data-highlighted:focus-visible:text-accent-foreground'

export interface NewProjectScriptInput {
  name: string
  command: string
  icon: ProjectScriptIcon
  runOnWorktreeCreate: boolean
  keybinding: string | null
}

interface ProjectScriptsControlProps {
  scripts: ProjectScript[]
  keybindings: ResolvedKeybindingsConfig
  preferredScriptId?: string | null
  onRunScript: (script: ProjectScript) => void
  onAddScript: (input: NewProjectScriptInput) => Promise<void> | void
  onUpdateScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void> | void
  onDeleteScript: (scriptId: string) => Promise<void> | void
}

type ProjectScriptDraftState = ReturnType<typeof useProjectScriptDraftState>

function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase()
  if (MODIFIER_SHORTCUT_KEYS.has(normalized)) return null
  if (normalized in SPECIAL_SHORTCUT_KEY_TOKENS) {
    return SPECIAL_SHORTCUT_KEY_TOKENS[normalized] ?? null
  }
  if (normalized.length === 1) return normalized
  if (normalized.startsWith('f') && normalized.length <= 3) return normalized
  return null
}

function keybindingFromEvent(event: KeyboardEvent<HTMLInputElement>): string | null {
  const keyToken = normalizeShortcutKeyToken(event.key)
  if (!keyToken) return null
  const parts: string[] = []
  if (isMacPlatform(navigator.platform)) {
    if (event.metaKey) parts.push('mod')
    if (event.ctrlKey) parts.push('ctrl')
  } else {
    if (event.ctrlKey) parts.push('mod')
    if (event.metaKey) parts.push('meta')
  }
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  if (parts.length === 0) return null
  parts.push(keyToken)
  return parts.join('+')
}

function useProjectScriptDraftState() {
  const addScriptFormId = React.useId()
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [icon, setIcon] = useState<ProjectScriptIcon>('play')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(false)
  const [keybinding, setKeybinding] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const resetClosedDialog = useCallback(() => {
    setEditingScriptId(null)
    setName('')
    setCommand('')
    setIcon('play')
    setRunOnWorktreeCreate(false)
    setKeybinding('')
    setValidationError(null)
  }, [])
  return {
    addScriptFormId,
    editingScriptId,
    setEditingScriptId,
    dialogOpen,
    setDialogOpen,
    name,
    setName,
    command,
    setCommand,
    icon,
    setIcon,
    iconPickerOpen,
    setIconPickerOpen,
    runOnWorktreeCreate,
    setRunOnWorktreeCreate,
    keybinding,
    setKeybinding,
    validationError,
    setValidationError,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    resetClosedDialog,
  }
}

function useProjectScriptsActions({
  scripts,
  keybindings,
  preferredScriptId = null,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
  draft,
}: ProjectScriptsControlProps & { draft: ProjectScriptDraftState }) {
  const primaryScript = useMemo(() => {
    if (preferredScriptId) {
      const preferred = scripts.find(script => script.id === preferredScriptId)
      if (preferred) return preferred
    }
    return primaryProjectScript(scripts)
  }, [preferredScriptId, scripts])

  return {
    primaryScript,
    ...useProjectScriptsDialogActions({
      scripts,
      keybindings,
      onAddScript,
      onUpdateScript,
      onDeleteScript,
      draft,
    }),
  }
}

async function saveProjectScriptDraft({
  scripts,
  onAddScript,
  onUpdateScript,
  draft,
}: {
  scripts: ProjectScript[]
  onAddScript: ProjectScriptsControlProps['onAddScript']
  onUpdateScript: ProjectScriptsControlProps['onUpdateScript']
  draft: ProjectScriptDraftState
}) {
  const trimmedName = draft.name.trim()
  const trimmedCommand = draft.command.trim()
  if (trimmedName.length === 0) return void draft.setValidationError('Name is required.')
  if (trimmedCommand.length === 0) return void draft.setValidationError('Command is required.')
  draft.setValidationError(null)
  const scriptId =
    draft.editingScriptId ??
    nextProjectScriptId(
      trimmedName,
      scripts.map(script => script.id)
    )
  const keybindingRule = decodeProjectScriptKeybindingRule({
    keybinding: draft.keybinding,
    command: commandForProjectScript(scriptId),
  })
  const payload = {
    name: trimmedName,
    command: trimmedCommand,
    icon: draft.icon,
    runOnWorktreeCreate: draft.runOnWorktreeCreate,
    keybinding: keybindingRule?.key ?? null,
  } satisfies NewProjectScriptInput
  if (draft.editingScriptId) await onUpdateScript(draft.editingScriptId, payload)
  else await onAddScript(payload)
  draft.setDialogOpen(false)
  draft.setIconPickerOpen(false)
}

function useProjectScriptsDialogActions({
  scripts,
  keybindings,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
  draft,
}: Pick<
  ProjectScriptsControlProps,
  'scripts' | 'keybindings' | 'onAddScript' | 'onUpdateScript' | 'onDeleteScript'
> & {
  draft: ProjectScriptDraftState
}) {
  const captureKeybinding = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Tab') return
      event.preventDefault()
      if (event.key === 'Backspace' || event.key === 'Delete') {
        draft.setKeybinding('')
        return
      }
      const next = keybindingFromEvent(event)
      if (next) draft.setKeybinding(next)
    },
    [draft]
  )

  const submitAddScript = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      try {
        await saveProjectScriptDraft({ scripts, onAddScript, onUpdateScript, draft })
      } catch (error) {
        draft.setValidationError(error instanceof Error ? error.message : 'Failed to save action.')
      }
    },
    [draft, onAddScript, onUpdateScript, scripts]
  )

  const openAddDialog = useCallback(() => {
    draft.resetClosedDialog()
    draft.setIconPickerOpen(false)
    draft.setDialogOpen(true)
  }, [draft])

  const openEditDialog = useCallback(
    (script: ProjectScript) => {
      draft.setEditingScriptId(script.id)
      draft.setName(script.name)
      draft.setCommand(script.command)
      draft.setIcon(script.icon)
      draft.setIconPickerOpen(false)
      draft.setRunOnWorktreeCreate(script.runOnWorktreeCreate)
      draft.setKeybinding(
        keybindingValueForCommand(keybindings, commandForProjectScript(script.id)) ?? ''
      )
      draft.setValidationError(null)
      draft.setDialogOpen(true)
    },
    [draft, keybindings]
  )

  const confirmDeleteScript = useCallback(() => {
    if (!draft.editingScriptId) return
    draft.setDeleteConfirmOpen(false)
    draft.setDialogOpen(false)
    void onDeleteScript(draft.editingScriptId)
  }, [draft, onDeleteScript])

  return { captureKeybinding, submitAddScript, openAddDialog, openEditDialog, confirmDeleteScript }
}

function ProjectScriptsDialogs({
  draft,
  captureKeybinding,
  submitAddScript,
  confirmDeleteScript,
}: {
  draft: ProjectScriptDraftState
  captureKeybinding: (event: KeyboardEvent<HTMLInputElement>) => void
  submitAddScript: (event: FormEvent) => Promise<void>
  confirmDeleteScript: () => void
}) {
  return (
    <>
      <ProjectScriptsDialog
        addScriptFormId={draft.addScriptFormId}
        dialogOpen={draft.dialogOpen}
        setDialogOpen={draft.setDialogOpen}
        isEditing={draft.editingScriptId !== null}
        iconPickerOpen={draft.iconPickerOpen}
        setIconPickerOpen={draft.setIconPickerOpen}
        icon={draft.icon}
        setIcon={draft.setIcon}
        name={draft.name}
        setName={draft.setName}
        keybinding={draft.keybinding}
        captureKeybinding={captureKeybinding}
        command={draft.command}
        setCommand={draft.setCommand}
        runOnWorktreeCreate={draft.runOnWorktreeCreate}
        setRunOnWorktreeCreate={draft.setRunOnWorktreeCreate}
        validationError={draft.validationError}
        submitAddScript={submitAddScript}
        resetClosedDialog={draft.resetClosedDialog}
        onOpenDeleteConfirm={() => draft.setDeleteConfirmOpen(true)}
      />
      <ProjectScriptsDeleteDialog
        deleteConfirmOpen={draft.deleteConfirmOpen}
        setDeleteConfirmOpen={draft.setDeleteConfirmOpen}
        name={draft.name}
        confirmDeleteScript={confirmDeleteScript}
      />
    </>
  )
}

export default function ProjectScriptsControl(props: ProjectScriptsControlProps) {
  const draft = useProjectScriptDraftState()
  const {
    primaryScript,
    captureKeybinding,
    submitAddScript,
    openAddDialog,
    openEditDialog,
    confirmDeleteScript,
  } = useProjectScriptsActions({ ...props, draft })

  return (
    <>
      <ProjectScriptsPrimaryControls
        scripts={props.scripts}
        primaryScript={primaryScript}
        keybindings={props.keybindings}
        dropdownItemClassName={DROPDOWN_ITEM_CLASS_NAME}
        onRunScript={props.onRunScript}
        onOpenEditDialog={openEditDialog}
        onOpenAddDialog={openAddDialog}
      />
      <ProjectScriptsDialogs
        draft={draft}
        captureKeybinding={captureKeybinding}
        submitAddScript={submitAddScript}
        confirmDeleteScript={confirmDeleteScript}
      />
    </>
  )
}
