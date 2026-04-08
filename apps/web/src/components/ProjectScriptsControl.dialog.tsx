import type { ProjectScriptIcon } from '@orxa-code/contracts'
import type { FormEvent, KeyboardEvent } from 'react'

import { ScriptIcon } from './ProjectScriptsControl.ui'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from './ui/alert-dialog'
import { Button } from './ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Popover, PopoverPopup, PopoverTrigger } from './ui/popover'
import { Switch } from './ui/switch'
import { Textarea } from './ui/textarea'

interface ScriptFormFields {
  addScriptFormId: string
  iconPickerOpen: boolean
  setIconPickerOpen: (open: boolean) => void
  icon: ProjectScriptIcon
  setIcon: (icon: ProjectScriptIcon) => void
  name: string
  setName: (name: string) => void
  keybinding: string
  captureKeybinding: (event: KeyboardEvent<HTMLInputElement>) => void
  command: string
  setCommand: (command: string) => void
  runOnWorktreeCreate: boolean
  setRunOnWorktreeCreate: (next: boolean) => void
  validationError: string | null
  submitAddScript: (event: FormEvent) => Promise<void>
}

const SCRIPT_ICONS: Array<{ id: ProjectScriptIcon; label: string }> = [
  { id: 'play', label: 'Play' },
  { id: 'test', label: 'Test' },
  { id: 'lint', label: 'Lint' },
  { id: 'configure', label: 'Configure' },
  { id: 'build', label: 'Build' },
  { id: 'debug', label: 'Debug' },
]

function ProjectScriptIconPicker({
  iconPickerOpen,
  setIconPickerOpen,
  icon,
  setIcon,
}: {
  iconPickerOpen: boolean
  setIconPickerOpen: (open: boolean) => void
  icon: ProjectScriptIcon
  setIcon: (icon: ProjectScriptIcon) => void
}) {
  return (
    <Popover onOpenChange={setIconPickerOpen} open={iconPickerOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="size-9 shrink-0 hover:bg-popover active:bg-popover data-pressed:bg-popover data-pressed:shadow-xs/5 data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)]"
            aria-label="Choose icon"
          />
        }
      >
        <ScriptIcon icon={icon} className="size-4.5" />
      </PopoverTrigger>
      <PopoverPopup align="start">
        <div className="grid grid-cols-3 gap-2">
          {SCRIPT_ICONS.map(entry => {
            const isSelected = entry.id === icon
            return (
              <button
                key={entry.id}
                type="button"
                className={`relative flex flex-col items-center gap-2 rounded-md border px-2 py-2 text-xs ${isSelected ? 'border-primary/70 bg-primary/10' : 'border-border/70 hover:bg-accent/60'}`}
                onClick={() => {
                  setIcon(entry.id)
                  setIconPickerOpen(false)
                }}
              >
                <ScriptIcon icon={entry.id} className="size-4" />
                <span>{entry.label}</span>
              </button>
            )
          })}
        </div>
      </PopoverPopup>
    </Popover>
  )
}

function ProjectScriptsNameField({
  iconPickerOpen,
  setIconPickerOpen,
  icon,
  setIcon,
  name,
  setName,
}: {
  iconPickerOpen: boolean
  setIconPickerOpen: (open: boolean) => void
  icon: ProjectScriptIcon
  setIcon: (icon: ProjectScriptIcon) => void
  name: string
  setName: (name: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="script-name">Name</Label>
      <div className="flex items-center gap-2">
        <ProjectScriptIconPicker
          iconPickerOpen={iconPickerOpen}
          setIconPickerOpen={setIconPickerOpen}
          icon={icon}
          setIcon={setIcon}
        />
        <Input
          id="script-name"
          autoFocus
          placeholder="Test"
          value={name}
          onChange={event => setName(event.target.value)}
        />
      </div>
    </div>
  )
}

function ProjectScriptsKeybindingField({
  keybinding,
  captureKeybinding,
}: {
  keybinding: string
  captureKeybinding: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="script-keybinding">Keybinding</Label>
      <Input
        id="script-keybinding"
        placeholder="Press shortcut"
        value={keybinding}
        readOnly
        onKeyDown={captureKeybinding}
      />
      <p className="text-xs text-muted-foreground">
        Press a shortcut. Use <code>Backspace</code> to clear.
      </p>
    </div>
  )
}

function ProjectScriptsCommandField({
  command,
  setCommand,
}: {
  command: string
  setCommand: (command: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="script-command">Command</Label>
      <Textarea
        id="script-command"
        placeholder="pnpm test"
        value={command}
        onChange={event => setCommand(event.target.value)}
      />
    </div>
  )
}

function ProjectScriptsWorktreeToggle({
  runOnWorktreeCreate,
  setRunOnWorktreeCreate,
}: {
  runOnWorktreeCreate: boolean
  setRunOnWorktreeCreate: (next: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
      <span>Run automatically on worktree creation</span>
      <Switch
        checked={runOnWorktreeCreate}
        onCheckedChange={checked => setRunOnWorktreeCreate(Boolean(checked))}
      />
    </label>
  )
}

function ProjectScriptsForm({
  addScriptFormId,
  iconPickerOpen,
  setIconPickerOpen,
  icon,
  setIcon,
  name,
  setName,
  keybinding,
  captureKeybinding,
  command,
  setCommand,
  runOnWorktreeCreate,
  setRunOnWorktreeCreate,
  validationError,
  submitAddScript,
}: ScriptFormFields) {
  return (
    <DialogPanel>
      <form id={addScriptFormId} className="space-y-4" onSubmit={submitAddScript}>
        <ProjectScriptsNameField
          iconPickerOpen={iconPickerOpen}
          setIconPickerOpen={setIconPickerOpen}
          icon={icon}
          setIcon={setIcon}
          name={name}
          setName={setName}
        />
        <ProjectScriptsKeybindingField
          keybinding={keybinding}
          captureKeybinding={captureKeybinding}
        />
        <ProjectScriptsCommandField command={command} setCommand={setCommand} />
        <ProjectScriptsWorktreeToggle
          runOnWorktreeCreate={runOnWorktreeCreate}
          setRunOnWorktreeCreate={setRunOnWorktreeCreate}
        />
        {validationError && <p className="text-sm text-destructive">{validationError}</p>}
      </form>
    </DialogPanel>
  )
}

function ProjectScriptsDialogContent(
  props: ScriptFormFields & {
    isEditing: boolean
    setDialogOpen: (open: boolean) => void
    onOpenDeleteConfirm: () => void
  }
) {
  return (
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>{props.isEditing ? 'Edit Action' : 'Add Action'}</DialogTitle>
        <DialogDescription>
          Actions are project-scoped commands you can run from the top bar or keybindings.
        </DialogDescription>
      </DialogHeader>
      <ProjectScriptsForm
        addScriptFormId={props.addScriptFormId}
        iconPickerOpen={props.iconPickerOpen}
        setIconPickerOpen={props.setIconPickerOpen}
        icon={props.icon}
        setIcon={props.setIcon}
        name={props.name}
        setName={props.setName}
        keybinding={props.keybinding}
        captureKeybinding={props.captureKeybinding}
        command={props.command}
        setCommand={props.setCommand}
        runOnWorktreeCreate={props.runOnWorktreeCreate}
        setRunOnWorktreeCreate={props.setRunOnWorktreeCreate}
        validationError={props.validationError}
        submitAddScript={props.submitAddScript}
      />
      <DialogFooter>
        {props.isEditing && (
          <Button
            type="button"
            variant="destructive-outline"
            className="mr-auto"
            onClick={props.onOpenDeleteConfirm}
          >
            Delete
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => props.setDialogOpen(false)}>
          Cancel
        </Button>
        <Button form={props.addScriptFormId} type="submit">
          {props.isEditing ? 'Save changes' : 'Save action'}
        </Button>
      </DialogFooter>
    </DialogPopup>
  )
}

export function ProjectScriptsDialog({
  dialogOpen,
  setDialogOpen,
  resetClosedDialog,
  ...props
}: ScriptFormFields & {
  dialogOpen: boolean
  setDialogOpen: (open: boolean) => void
  isEditing: boolean
  resetClosedDialog: () => void
  onOpenDeleteConfirm: () => void
}) {
  return (
    <Dialog
      onOpenChange={open => {
        setDialogOpen(open)
        if (!open) props.setIconPickerOpen(false)
      }}
      onOpenChangeComplete={open => {
        if (!open) resetClosedDialog()
      }}
      open={dialogOpen}
    >
      <ProjectScriptsDialogContent {...props} setDialogOpen={setDialogOpen} />
    </Dialog>
  )
}

export function ProjectScriptsDeleteDialog({
  deleteConfirmOpen,
  setDeleteConfirmOpen,
  name,
  confirmDeleteScript,
}: {
  deleteConfirmOpen: boolean
  setDeleteConfirmOpen: (open: boolean) => void
  name: string
  confirmDeleteScript: () => void
}) {
  return (
    <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete action "{name}"?</AlertDialogTitle>
          <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button variant="destructive" onClick={confirmDeleteScript}>
            Delete action
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}
