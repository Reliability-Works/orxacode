import type {
  ProjectScript,
  ProjectScriptIcon,
  ResolvedKeybindingsConfig,
} from '@orxa-code/contracts'
import {
  BugIcon,
  ChevronDownIcon,
  FlaskConicalIcon,
  HammerIcon,
  ListChecksIcon,
  PlayIcon,
  RocketIcon,
  SettingsIcon,
  WrenchIcon,
} from 'lucide-react'
import { shortcutLabelForCommand } from '~/keybindings'
import { commandForProjectScript } from '~/projectScripts'
import { Button } from './ui/button'
import { Group, GroupSeparator } from './ui/group'
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from './ui/menu'

export function ScriptIcon({
  icon,
  className = 'size-3.5',
}: {
  icon: ProjectScriptIcon
  className?: string
}) {
  if (icon === 'test') return <FlaskConicalIcon className={className} />
  if (icon === 'lint') return <ListChecksIcon className={className} />
  if (icon === 'configure') return <WrenchIcon className={className} />
  if (icon === 'build') return <HammerIcon className={className} />
  if (icon === 'debug') return <BugIcon className={className} />
  return <PlayIcon className={className} />
}

function ProjectScriptMenuItem({
  script,
  keybindings,
  dropdownItemClassName,
  onRunScript,
  onOpenEditDialog,
}: {
  script: ProjectScript
  keybindings: ResolvedKeybindingsConfig
  dropdownItemClassName: string
  onRunScript: (script: ProjectScript) => void
  onOpenEditDialog: (script: ProjectScript) => void
}) {
  const shortcutLabel = shortcutLabelForCommand(keybindings, commandForProjectScript(script.id))
  return (
    <MenuItem className={`group ${dropdownItemClassName}`} onClick={() => onRunScript(script)}>
      <ScriptIcon icon={script.icon} className="size-4" />
      <span className="truncate">
        {script.runOnWorktreeCreate ? `${script.name} (setup)` : script.name}
      </span>
      <span className="relative ms-auto flex h-6 min-w-6 items-center justify-end">
        {shortcutLabel && (
          <MenuShortcut className="ms-0 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
            {shortcutLabel}
          </MenuShortcut>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute right-0 top-1/2 size-6 -translate-y-1/2 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-visible:opacity-100 group-focus-visible:pointer-events-auto"
          aria-label={`Edit ${script.name}`}
          onPointerDown={event => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            onOpenEditDialog(script)
          }}
        >
          <SettingsIcon className="size-3.5" />
        </Button>
      </span>
    </MenuItem>
  )
}

export function ProjectScriptsPrimaryControls({
  scripts,
  primaryScript,
  keybindings,
  dropdownItemClassName,
  onRunScript,
  onOpenEditDialog,
  onOpenAddDialog,
}: {
  scripts: ProjectScript[]
  primaryScript: ProjectScript | null
  keybindings: ResolvedKeybindingsConfig
  dropdownItemClassName: string
  onRunScript: (script: ProjectScript) => void
  onOpenEditDialog: (script: ProjectScript) => void
  onOpenAddDialog: () => void
}) {
  if (!primaryScript) {
    return (
      <Button size="xs" variant="outline" onClick={onOpenAddDialog} title="Add action">
        <RocketIcon className="size-3.5" />
        <span className="sr-only">Add action</span>
      </Button>
    )
  }

  return (
    <Group aria-label="Project scripts">
      <Button
        size="xs"
        variant="outline"
        onClick={() => onRunScript(primaryScript)}
        title={`Run ${primaryScript.name}`}
      >
        <ScriptIcon icon={primaryScript.icon} />
        <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
          {primaryScript.name}
        </span>
      </Button>
      <GroupSeparator className="hidden @3xl/header-actions:block" />
      <Menu highlightItemOnHover={false}>
        <MenuTrigger
          render={<Button size="icon-xs" variant="outline" aria-label="Script actions" />}
        >
          <ChevronDownIcon className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          {scripts.map(script => (
            <ProjectScriptMenuItem
              key={script.id}
              script={script}
              keybindings={keybindings}
              dropdownItemClassName={dropdownItemClassName}
              onRunScript={onRunScript}
              onOpenEditDialog={onOpenEditDialog}
            />
          ))}
          <MenuItem className={dropdownItemClassName} onClick={onOpenAddDialog}>
            <RocketIcon className="size-4" />
            Add action
          </MenuItem>
        </MenuPopup>
      </Menu>
    </Group>
  )
}
