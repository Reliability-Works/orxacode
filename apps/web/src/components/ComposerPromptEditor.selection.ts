import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type ElementNode,
  type LexicalNode,
} from 'lexical'

import { splitPromptIntoComposerSegments } from '~/composer-editor-mentions'
import { type TerminalContextDraft } from '~/lib/terminalContext'

import {
  $createComposerMentionNode,
  $createComposerTerminalContextNode,
  ComposerInlineTokenNode,
  ComposerMentionNode,
  ComposerTerminalContextNode,
  isComposerInlineTokenNode,
} from './ComposerPromptEditor.nodes'

export function terminalContextSignature(contexts: ReadonlyArray<TerminalContextDraft>): string {
  return contexts
    .map(context =>
      [
        context.id,
        context.threadId,
        context.terminalId,
        context.terminalLabel,
        context.lineStart,
        context.lineEnd,
        context.createdAt,
        context.text,
      ].join('\u001f')
    )
    .join('\u001e')
}

export function clampExpandedCursor(value: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return value.length
  return Math.max(0, Math.min(value.length, Math.floor(cursor)))
}

function getComposerInlineTokenTextLength(node: ComposerInlineTokenNode): 1 {
  void node
  return 1
}

function getComposerInlineTokenExpandedTextLength(node: ComposerInlineTokenNode): number {
  return node.getTextContentSize()
}

function getAbsoluteOffsetForInlineTokenPoint(
  node: ComposerInlineTokenNode,
  absoluteOffset: number,
  pointOffset: number
): number {
  return absoluteOffset + (pointOffset > 0 ? getComposerInlineTokenTextLength(node) : 0)
}

function getExpandedAbsoluteOffsetForInlineTokenPoint(
  node: ComposerInlineTokenNode,
  absoluteOffset: number,
  pointOffset: number
): number {
  return absoluteOffset + (pointOffset > 0 ? getComposerInlineTokenExpandedTextLength(node) : 0)
}

function findSelectionPointForInlineToken(
  node: ComposerInlineTokenNode,
  remainingRef: { value: number }
): { key: string; offset: number; type: 'element' } | null {
  const parent = node.getParent()
  if (!parent || !$isElementNode(parent)) return null
  const index = node.getIndexWithinParent()
  if (remainingRef.value === 0) {
    return { key: parent.getKey(), offset: index, type: 'element' }
  }
  if (remainingRef.value === getComposerInlineTokenTextLength(node)) {
    return { key: parent.getKey(), offset: index + 1, type: 'element' }
  }
  remainingRef.value -= getComposerInlineTokenTextLength(node)
  return null
}

type TokenLengthFn = (node: ComposerInlineTokenNode) => number

function computeNodeLength(
  node: LexicalNode,
  getTokenLength: TokenLengthFn,
  self: (child: LexicalNode) => number
): number {
  if (isComposerInlineTokenNode(node)) {
    return getTokenLength(node)
  }
  if ($isTextNode(node)) {
    return node.getTextContentSize()
  }
  if ($isLineBreakNode(node)) {
    return 1
  }
  if ($isElementNode(node)) {
    return node.getChildren().reduce((total, child) => total + self(child), 0)
  }
  return 0
}

function getComposerNodeTextLength(node: LexicalNode): number {
  return computeNodeLength(node, getComposerInlineTokenTextLength, getComposerNodeTextLength)
}

function getComposerNodeExpandedTextLength(node: LexicalNode): number {
  return computeNodeLength(
    node,
    getComposerInlineTokenExpandedTextLength,
    getComposerNodeExpandedTextLength
  )
}

type NodeLengthFn = (node: LexicalNode) => number
type InlineTokenOffsetFn = (
  node: ComposerInlineTokenNode,
  absoluteOffset: number,
  pointOffset: number
) => number

function computeAbsoluteOffsetForPoint(
  node: LexicalNode,
  pointOffset: number,
  getNodeLength: NodeLengthFn,
  getInlineTokenOffset: InlineTokenOffsetFn
): number {
  let offset = 0
  let current: LexicalNode | null = node

  while (current) {
    const nextParent = current.getParent() as LexicalNode | null
    if (!nextParent || !$isElementNode(nextParent)) {
      break
    }
    const siblings = nextParent.getChildren()
    const index = current.getIndexWithinParent()
    for (let i = 0; i < index; i += 1) {
      const sibling = siblings[i]
      if (!sibling) continue
      offset += getNodeLength(sibling)
    }
    current = nextParent
  }

  if ($isTextNode(node)) {
    if (node instanceof ComposerMentionNode) {
      return getInlineTokenOffset(node, offset, pointOffset)
    }
    return offset + Math.min(pointOffset, node.getTextContentSize())
  }
  if (node instanceof ComposerTerminalContextNode) {
    return getInlineTokenOffset(node, offset, pointOffset)
  }
  if ($isLineBreakNode(node)) {
    return offset + Math.min(pointOffset, 1)
  }
  if ($isElementNode(node)) {
    const children = node.getChildren()
    const clampedOffset = Math.max(0, Math.min(pointOffset, children.length))
    for (let i = 0; i < clampedOffset; i += 1) {
      const child = children[i]
      if (!child) continue
      offset += getNodeLength(child)
    }
  }

  return offset
}

export function getAbsoluteOffsetForPoint(node: LexicalNode, pointOffset: number): number {
  return computeAbsoluteOffsetForPoint(
    node,
    pointOffset,
    getComposerNodeTextLength,
    getAbsoluteOffsetForInlineTokenPoint
  )
}

function getExpandedAbsoluteOffsetForPoint(node: LexicalNode, pointOffset: number): number {
  return computeAbsoluteOffsetForPoint(
    node,
    pointOffset,
    getComposerNodeExpandedTextLength,
    getExpandedAbsoluteOffsetForInlineTokenPoint
  )
}

function findSelectionPointAtOffset(
  node: LexicalNode,
  remainingRef: { value: number }
): { key: string; offset: number; type: 'text' | 'element' } | null {
  if (node instanceof ComposerMentionNode || node instanceof ComposerTerminalContextNode) {
    return findSelectionPointForInlineToken(node, remainingRef)
  }

  if ($isTextNode(node)) {
    const size = node.getTextContentSize()
    if (remainingRef.value <= size) {
      return { key: node.getKey(), offset: remainingRef.value, type: 'text' }
    }
    remainingRef.value -= size
    return null
  }

  if ($isLineBreakNode(node)) {
    const parent = node.getParent()
    if (!parent) return null
    const index = node.getIndexWithinParent()
    if (remainingRef.value === 0) {
      return { key: parent.getKey(), offset: index, type: 'element' }
    }
    if (remainingRef.value === 1) {
      return { key: parent.getKey(), offset: index + 1, type: 'element' }
    }
    remainingRef.value -= 1
    return null
  }

  if ($isElementNode(node)) {
    const children = node.getChildren()
    for (const child of children) {
      const point = findSelectionPointAtOffset(child, remainingRef)
      if (point) {
        return point
      }
    }
    if (remainingRef.value === 0) {
      return { key: node.getKey(), offset: children.length, type: 'element' }
    }
  }

  return null
}

function getComposerRootLength(): number {
  const root = $getRoot()
  return root.getChildren().reduce((sum, child) => sum + getComposerNodeTextLength(child), 0)
}

export function $setSelectionAtComposerOffset(nextOffset: number): void {
  const root = $getRoot()
  const composerLength = getComposerRootLength()
  const boundedOffset = Math.max(0, Math.min(nextOffset, composerLength))
  const remainingRef = { value: boundedOffset }
  const point = findSelectionPointAtOffset(root, remainingRef) ?? {
    key: root.getKey(),
    offset: root.getChildren().length,
    type: 'element' as const,
  }
  const selection = $createRangeSelection()
  selection.anchor.set(point.key, point.offset, point.type)
  selection.focus.set(point.key, point.offset, point.type)
  $setSelection(selection)
}

export function $readSelectionOffsetFromEditorState(fallback: number): number {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return fallback
  }
  const anchorNode = selection.anchor.getNode()
  const offset = getAbsoluteOffsetForPoint(anchorNode, selection.anchor.offset)
  const composerLength = getComposerRootLength()
  return Math.max(0, Math.min(offset, composerLength))
}

export function $readExpandedSelectionOffsetFromEditorState(fallback: number): number {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return fallback
  }
  const anchorNode = selection.anchor.getNode()
  const offset = getExpandedAbsoluteOffsetForPoint(anchorNode, selection.anchor.offset)
  const expandedLength = $getRoot().getTextContent().length
  return Math.max(0, Math.min(offset, expandedLength))
}

function appendTextWithLineBreaks(parent: ElementNode, text: string): void {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.length > 0) {
      parent.append($createTextNode(line))
    }
    if (index < lines.length - 1) {
      parent.append($createLineBreakNode())
    }
  }
}

export function $setComposerEditorPrompt(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft>
): void {
  const root = $getRoot()
  root.clear()
  const paragraph = $createParagraphNode()
  root.append(paragraph)

  const segments = splitPromptIntoComposerSegments(prompt, terminalContexts)
  for (const segment of segments) {
    if (segment.type === 'mention') {
      paragraph.append($createComposerMentionNode(segment.path))
      continue
    }
    if (segment.type === 'terminal-context') {
      if (segment.context) {
        paragraph.append($createComposerTerminalContextNode(segment.context))
      }
      continue
    }
    appendTextWithLineBreaks(paragraph, segment.text)
  }
}

export function collectTerminalContextIds(node: LexicalNode): string[] {
  if (node instanceof ComposerTerminalContextNode) {
    return [node.__context.id]
  }
  if ($isElementNode(node)) {
    return node.getChildren().flatMap(child => collectTerminalContextIds(child))
  }
  return []
}
