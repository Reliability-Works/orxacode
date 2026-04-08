import {
  $applyNodeReplacement,
  DecoratorNode,
  TextNode,
  type EditorConfig,
  type NodeKey,
  type SerializedLexicalNode,
  type SerializedTextNode,
  type Spread,
} from 'lexical'
import { createContext, createElement, type ReactElement } from 'react'

import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
} from '~/lib/terminalContext'
import { basenameOfPath, getVscodeIconUrlForEntry, inferEntryKindFromPath } from '~/vscode-icons'

import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from './composerInlineChip'
import { ComposerPendingTerminalContextChip } from './chat/ComposerPendingTerminalContexts'

export type SerializedComposerMentionNode = Spread<
  {
    path: string
    type: 'composer-mention'
    version: 1
  },
  SerializedTextNode
>

export type SerializedComposerTerminalContextNode = Spread<
  {
    context: TerminalContextDraft
    type: 'composer-terminal-context'
    version: 1
  },
  SerializedLexicalNode
>

export const ComposerTerminalContextActionsContext = createContext<{
  onRemoveTerminalContext: (contextId: string) => void
}>({
  onRemoveTerminalContext: () => {},
})

function resolvedThemeFromDocument(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function renderMentionChipDom(container: HTMLElement, pathValue: string): void {
  container.textContent = ''
  container.style.setProperty('user-select', 'none')
  container.style.setProperty('-webkit-user-select', 'none')

  const theme = resolvedThemeFromDocument()
  const icon = document.createElement('img')
  icon.alt = ''
  icon.ariaHidden = 'true'
  icon.className = COMPOSER_INLINE_CHIP_ICON_CLASS_NAME
  icon.loading = 'lazy'
  icon.src = getVscodeIconUrlForEntry(pathValue, inferEntryKindFromPath(pathValue), theme)

  const label = document.createElement('span')
  label.className = COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME
  label.textContent = basenameOfPath(pathValue)

  container.append(icon, label)
}

export class ComposerMentionNode extends TextNode {
  __path: string

  static override getType(): string {
    return 'composer-mention'
  }

  static override clone(node: ComposerMentionNode): ComposerMentionNode {
    return new ComposerMentionNode(node.__path, node.__key)
  }

  static override importJSON(serializedNode: SerializedComposerMentionNode): ComposerMentionNode {
    return $createComposerMentionNode(serializedNode.path)
  }

  constructor(path: string, key?: NodeKey) {
    const normalizedPath = path.startsWith('@') ? path.slice(1) : path
    super(`@${normalizedPath}`, key)
    this.__path = normalizedPath
  }

  override exportJSON(): SerializedComposerMentionNode {
    return {
      ...super.exportJSON(),
      path: this.__path,
      type: 'composer-mention',
      version: 1,
    }
  }

  override createDOM(config: EditorConfig): HTMLElement {
    void config
    const dom = document.createElement('span')
    dom.className = COMPOSER_INLINE_CHIP_CLASS_NAME
    dom.contentEditable = 'false'
    dom.setAttribute('spellcheck', 'false')
    renderMentionChipDom(dom, this.__path)
    return dom
  }

  override updateDOM(
    prevNode: ComposerMentionNode,
    dom: HTMLElement,
    config: EditorConfig
  ): boolean {
    void config
    dom.contentEditable = 'false'
    if (prevNode.__text !== this.__text || prevNode.__path !== this.__path) {
      renderMentionChipDom(dom, this.__path)
    }
    return false
  }

  override canInsertTextBefore(): false {
    return false
  }

  override canInsertTextAfter(): false {
    return false
  }

  override isTextEntity(): true {
    return true
  }

  override isToken(): true {
    return true
  }
}

function renderTerminalContextChip(context: TerminalContextDraft): ReactElement {
  return createElement(ComposerPendingTerminalContextChip, { context })
}

export class ComposerTerminalContextNode extends DecoratorNode<ReactElement> {
  __context: TerminalContextDraft

  static override getType(): string {
    return 'composer-terminal-context'
  }

  static override clone(node: ComposerTerminalContextNode): ComposerTerminalContextNode {
    return new ComposerTerminalContextNode(node.__context, node.__key)
  }

  static override importJSON(
    serializedNode: SerializedComposerTerminalContextNode
  ): ComposerTerminalContextNode {
    return $createComposerTerminalContextNode(serializedNode.context)
  }

  constructor(context: TerminalContextDraft, key?: NodeKey) {
    super(key)
    this.__context = context
  }

  override exportJSON(): SerializedComposerTerminalContextNode {
    return {
      ...super.exportJSON(),
      context: this.__context,
      type: 'composer-terminal-context',
      version: 1,
    }
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement('span')
    dom.className = 'inline-flex align-middle leading-none'
    return dom
  }

  override updateDOM(): false {
    return false
  }

  override getTextContent(): string {
    return INLINE_TERMINAL_CONTEXT_PLACEHOLDER
  }

  override isInline(): true {
    return true
  }

  override decorate(): ReactElement {
    return renderTerminalContextChip(this.__context)
  }
}

export function $createComposerMentionNode(path: string): ComposerMentionNode {
  return $applyNodeReplacement(new ComposerMentionNode(path))
}

export function $createComposerTerminalContextNode(
  context: TerminalContextDraft
): ComposerTerminalContextNode {
  return $applyNodeReplacement(new ComposerTerminalContextNode(context))
}

export type ComposerInlineTokenNode = ComposerMentionNode | ComposerTerminalContextNode

export function isComposerInlineTokenNode(
  candidate: unknown
): candidate is ComposerInlineTokenNode {
  return (
    candidate instanceof ComposerMentionNode || candidate instanceof ComposerTerminalContextNode
  )
}
