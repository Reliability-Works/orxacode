import { EditorId, type ResolvedKeybindingsConfig } from '@orxa-code/contracts'
import { memo, useCallback, useEffect, useMemo } from 'react'
import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from '../../keybindings'
import { usePreferredEditor } from '../../editorPreferences'
import { ChevronDownIcon } from 'lucide-react'
import { Button } from '../ui/button'
import { Group, GroupSeparator } from '../ui/group'
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from '../ui/menu'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import { cn } from '~/lib/utils'
import type { MenuVisual } from './OpenInPicker.options'
import { resolveOpenInOptions } from './OpenInPicker.options'
import { readNativeApi } from '~/nativeApi'

function OpenInOptionVisual({ visual, className }: { visual: MenuVisual; className?: string }) {
  if (visual.kind === 'image') {
    return (
      <img
        alt=""
        aria-hidden="true"
        src={visual.src}
        className={cn('size-4 shrink-0 object-contain', visual.rounded !== false && 'rounded-sm')}
      />
    )
  }
  if (visual.kind === 'simple') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={cn('size-4 shrink-0', className)}
        fill="none"
      >
        <path d={visual.icon.path} fill={`#${visual.icon.hex}`} />
      </svg>
    )
  }
  const IconComponent = visual.Icon
  return <IconComponent aria-hidden="true" className={cn('size-4 shrink-0', className)} />
}

function OpenInPrimaryButton(props: {
  disabled: boolean
  visual: ReturnType<typeof resolveOpenInOptions>[number]['visual'] | null
  onClick: () => void
}) {
  const { disabled, visual, onClick } = props
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="outline"
            disabled={disabled}
            onClick={onClick}
            aria-label="Open in preferred editor"
          />
        }
      >
        {visual && <OpenInOptionVisual visual={visual} />}
        <span className="sr-only">Open</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {disabled ? 'Open in preferred editor unavailable' : 'Open in preferred editor'}
      </TooltipPopup>
    </Tooltip>
  )
}

function OpenInMenuItems(props: {
  options: ReturnType<typeof resolveOpenInOptions>
  preferredEditor: EditorId | null
  openFavoriteEditorShortcutLabel: string | null
  onOpenEditor: (editorId: EditorId) => void
}) {
  const { options, preferredEditor, openFavoriteEditorShortcutLabel, onOpenEditor } = props
  if (options.length === 0) {
    return <MenuItem disabled>No installed editors found</MenuItem>
  }

  return options.map(({ label, value, visual }) => (
    <MenuItem key={value} onClick={() => onOpenEditor(value)}>
      <OpenInOptionVisual visual={visual} className="text-muted-foreground" />
      {label}
      {value === preferredEditor && openFavoriteEditorShortcutLabel && (
        <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
      )}
    </MenuItem>
  ))
}

export const OpenInPicker = memo(function OpenInPicker({
  keybindings,
  availableEditors,
  openInCwd,
}: {
  keybindings: ResolvedKeybindingsConfig
  availableEditors: ReadonlyArray<EditorId>
  openInCwd: string | null
}) {
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(availableEditors)
  const options = useMemo(
    () => resolveOpenInOptions(navigator.platform, availableEditors),
    [availableEditors]
  )
  const primaryOption = options.find(({ value }) => value === preferredEditor) ?? null

  const openInEditor = useCallback(
    (editorId: EditorId | null) => {
      const api = readNativeApi()
      if (!api || !openInCwd) return
      const editor = editorId ?? preferredEditor
      if (!editor) return
      void api.shell.openInEditor(openInCwd, editor)
      setPreferredEditor(editor)
    },
    [preferredEditor, openInCwd, setPreferredEditor]
  )

  const openFavoriteEditorShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, 'editor.openFavorite'),
    [keybindings]
  )

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const api = readNativeApi()
      if (!isOpenFavoriteEditorShortcut(e, keybindings)) return
      if (!api || !openInCwd) return
      if (!preferredEditor) return

      e.preventDefault()
      void api.shell.openInEditor(openInCwd, preferredEditor)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [preferredEditor, keybindings, openInCwd])

  return (
    <Group aria-label="Subscription actions">
      <OpenInPrimaryButton
        disabled={!preferredEditor || !openInCwd}
        visual={primaryOption?.visual ?? null}
        onClick={() => openInEditor(preferredEditor)}
      />
      <GroupSeparator className="hidden @3xl/header-actions:block" />
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label="Open in editor options"
              title="Open in editor options"
              size="icon-xs"
              variant="outline"
            />
          }
        >
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          <OpenInMenuItems
            options={options}
            preferredEditor={preferredEditor}
            openFavoriteEditorShortcutLabel={openFavoriteEditorShortcutLabel}
            onOpenEditor={openInEditor}
          />
        </MenuPopup>
      </Menu>
    </Group>
  )
})
