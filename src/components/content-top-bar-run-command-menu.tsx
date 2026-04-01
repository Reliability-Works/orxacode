import { Pencil, Play, Plus, Trash2 } from 'lucide-react'
import type { CustomRunCommandPreset } from './ContentTopBar'

function summarizeCommands(commands: string) {
  const lines = commands
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
  if (lines.length === 0) return 'No commands'
  if (lines.length === 1) return lines[0]!
  return `${lines[0]!} (+${lines.length - 1} more)`
}

type RunCommandMenuProps = {
  open: boolean
  presets: CustomRunCommandPreset[]
  onRun: (preset: CustomRunCommandPreset) => Promise<void>
  onEdit: (preset: CustomRunCommandPreset) => void
  onDelete: (preset: CustomRunCommandPreset) => void
  onAdd: () => void
}

export function RunCommandMenu({ open, presets, onRun, onEdit, onDelete, onAdd }: RunCommandMenuProps) {
  if (!open) return null
  return (
    <div className="titlebar-run-menu" role="menu" aria-label="Custom run commands">
      <small>Custom run commands</small>
      {presets.map(preset => (
        <div key={preset.id} className="titlebar-run-menu-item">
          <div className="titlebar-run-menu-item-main">
            <span className="titlebar-run-menu-item-title">{preset.title}</span>
            <span className="titlebar-run-menu-item-preview">{summarizeCommands(preset.commands)}</span>
          </div>
          <button type="button" aria-label={`Run ${preset.title}`} title={`Run ${preset.title}`} onClick={() => void onRun(preset)}>
            <Play size={12} aria-hidden="true" />
          </button>
          <button type="button" aria-label={`Edit ${preset.title}`} title={`Edit ${preset.title}`} onClick={() => onEdit(preset)}>
            <Pencil size={12} aria-hidden="true" />
          </button>
          <button type="button" aria-label={`Delete ${preset.title}`} title={`Delete ${preset.title}`} onClick={() => onDelete(preset)}>
            <Trash2 size={12} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" className="titlebar-run-menu-add" onClick={onAdd}>
        <Plus size={13} aria-hidden="true" />
        <span>Add new run command</span>
      </button>
    </div>
  )
}
