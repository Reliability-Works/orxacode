import type { EditorId } from '@orxa-code/contracts'
import { FolderClosedIcon } from 'lucide-react'
import { siAndroidstudio, siIterm2, siVscodium } from 'simple-icons'
import type { ComponentType, SVGProps } from 'react'
import { AntigravityIcon } from '../Icons'
import cursorIcon from '../../assets/editor-icons/cursor.png'
import finderIcon from '../../assets/editor-icons/finder.png'
import ghosttyIcon from '../../assets/editor-icons/ghostty.png'
import terminalIcon from '../../assets/editor-icons/terminal.png'
import traeIcon from '../../assets/editor-icons/trae.png'
import vscodeIcon from '../../assets/editor-icons/vscode.png'
import xcodeIcon from '../../assets/editor-icons/xcode.png'
import zedIcon from '../../assets/editor-icons/zed.png'
import { isMacPlatform, isWindowsPlatform } from '~/lib/utils'

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>

export interface SimpleIconDefinition {
  hex: string
  path: string
}

export type MenuVisual =
  | { kind: 'image'; src: string; rounded?: boolean }
  | { kind: 'component'; Icon: SvgComponent }
  | { kind: 'simple'; icon: SimpleIconDefinition }

export interface OpenInOption {
  label: string
  value: EditorId
  visual: MenuVisual
}

function resolveFileManagerVisual(platform: string): MenuVisual {
  if (isMacPlatform(platform)) {
    return { kind: 'image', src: finderIcon, rounded: false }
  }
  return { kind: 'component', Icon: FolderClosedIcon }
}

function resolveFileManagerLabel(platform: string): string {
  if (isMacPlatform(platform)) {
    return 'Finder'
  }
  if (isWindowsPlatform(platform)) {
    return 'Explorer'
  }
  return 'Files'
}

function createStaticOptions(platform: string): ReadonlyArray<OpenInOption> {
  return [
    { label: 'Cursor', value: 'cursor', visual: { kind: 'image', src: cursorIcon } },
    { label: 'Trae', value: 'trae', visual: { kind: 'image', src: traeIcon } },
    { label: 'VS Code', value: 'vscode', visual: { kind: 'image', src: vscodeIcon } },
    {
      label: 'VS Code Insiders',
      value: 'vscode-insiders',
      visual: { kind: 'image', src: vscodeIcon },
    },
    { label: 'VSCodium', value: 'vscodium', visual: { kind: 'simple', icon: siVscodium } },
    { label: 'Zed', value: 'zed', visual: { kind: 'image', src: zedIcon } },
    {
      label: 'Android Studio',
      value: 'android-studio',
      visual: { kind: 'simple', icon: siAndroidstudio },
    },
    { label: 'Xcode', value: 'xcode', visual: { kind: 'image', src: xcodeIcon } },
    {
      label: 'Terminal',
      value: 'terminal',
      visual: { kind: 'image', src: terminalIcon, rounded: false },
    },
    { label: 'iTerm', value: 'iterm', visual: { kind: 'simple', icon: siIterm2 } },
    { label: 'Ghostty', value: 'ghostty', visual: { kind: 'image', src: ghosttyIcon } },
    {
      label: 'Antigravity',
      value: 'antigravity',
      visual: { kind: 'component', Icon: AntigravityIcon as SvgComponent },
    },
    {
      label: resolveFileManagerLabel(platform),
      value: 'file-manager',
      visual: resolveFileManagerVisual(platform),
    },
  ]
}

export function resolveOpenInOptions(
  platform: string,
  availableEditors: ReadonlyArray<EditorId>
): ReadonlyArray<OpenInOption> {
  return createStaticOptions(platform).filter(option => availableEditors.includes(option.value))
}
