import { EditorId, type ResolvedKeybindingsConfig } from '@orxa-code/contracts'
import { memo, useCallback, useEffect, useMemo } from 'react'
import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from '../../keybindings'
import { usePreferredEditor } from '../../editorPreferences'
import { ChevronDownIcon, FolderClosedIcon } from 'lucide-react'
import { Button } from '../ui/button'
import { Group, GroupSeparator } from '../ui/group'
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from '../ui/menu'
import { AntigravityIcon, CursorIcon, Icon, TraeIcon, VisualStudioCode, Zed } from '../Icons'
import { isMacPlatform, isWindowsPlatform } from '~/lib/utils'
import { readNativeApi } from '~/nativeApi'

const resolveOptions = (platform: string, availableEditors: ReadonlyArray<EditorId>) => {
  const baseOptions: ReadonlyArray<{ label: string; Icon: Icon; value: EditorId }> = [
    {
      label: 'Cursor',
      Icon: CursorIcon,
      value: 'cursor',
    },
    {
      label: 'Trae',
      Icon: TraeIcon,
      value: 'trae',
    },
    {
      label: 'VS Code',
      Icon: VisualStudioCode,
      value: 'vscode',
    },
    {
      label: 'VS Code Insiders',
      Icon: VisualStudioCode,
      value: 'vscode-insiders',
    },
    {
      label: 'VSCodium',
      Icon: VisualStudioCode,
      value: 'vscodium',
    },
    {
      label: 'Zed',
      Icon: Zed,
      value: 'zed',
    },
    {
      label: 'Antigravity',
      Icon: AntigravityIcon,
      value: 'antigravity',
    },
    {
      label: isMacPlatform(platform)
        ? 'Finder'
        : isWindowsPlatform(platform)
          ? 'Explorer'
          : 'Files',
      Icon: FolderClosedIcon,
      value: 'file-manager',
    },
  ]
  return baseOptions.filter(option => availableEditors.includes(option.value))
}

function OpenInPrimaryButton(props: { disabled: boolean; Icon: Icon | null; onClick: () => void }) {
  const { disabled, Icon, onClick } = props
  return (
    <Button size="xs" variant="outline" disabled={disabled} onClick={onClick}>
      {Icon && <Icon aria-hidden="true" className="size-3.5" />}
      <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
        Open
      </span>
    </Button>
  )
}

function OpenInMenuItems(props: {
  options: ReturnType<typeof resolveOptions>
  preferredEditor: EditorId | null
  openFavoriteEditorShortcutLabel: string | null
  onOpenEditor: (editorId: EditorId) => void
}) {
  const { options, preferredEditor, openFavoriteEditorShortcutLabel, onOpenEditor } = props
  if (options.length === 0) {
    return <MenuItem disabled>No installed editors found</MenuItem>
  }

  return options.map(({ label, Icon, value }) => (
    <MenuItem key={value} onClick={() => onOpenEditor(value)}>
      <Icon aria-hidden="true" className="text-muted-foreground" />
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
    () => resolveOptions(navigator.platform, availableEditors),
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
        Icon={primaryOption?.Icon ?? null}
        onClick={() => openInEditor(preferredEditor)}
      />
      <GroupSeparator className="hidden @3xl/header-actions:block" />
      <Menu>
        <MenuTrigger render={<Button aria-label="Copy options" size="icon-xs" variant="outline" />}>
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
