import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalNode,
} from 'lexical'
import { useContext, useEffect } from 'react'

import { isCollapsedCursorAdjacentToInlineToken } from '~/composer-logic'

import {
  ComposerTerminalContextActionsContext,
  ComposerTerminalContextNode,
  isComposerInlineTokenNode,
} from './ComposerPromptEditor.nodes'
import {
  $readSelectionOffsetFromEditorState,
  $setSelectionAtComposerOffset,
  getAbsoluteOffsetForPoint,
} from './ComposerPromptEditor.selection'

type ComposerCommandKey = 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Tab'

export function ComposerCommandKeyPlugin(props: {
  onCommandKeyDown?: (key: ComposerCommandKey, event: KeyboardEvent) => boolean
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const handleCommand = (key: ComposerCommandKey, event: KeyboardEvent | null): boolean => {
      if (!props.onCommandKeyDown || !event) {
        return false
      }
      const handled = props.onCommandKeyDown(key, event)
      if (handled) {
        event.preventDefault()
        event.stopPropagation()
      }
      return handled
    }

    const unregisterArrowDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      event => handleCommand('ArrowDown', event),
      COMMAND_PRIORITY_HIGH
    )
    const unregisterArrowUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      event => handleCommand('ArrowUp', event),
      COMMAND_PRIORITY_HIGH
    )
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      event => handleCommand('Enter', event),
      COMMAND_PRIORITY_HIGH
    )
    const unregisterTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      event => handleCommand('Tab', event),
      COMMAND_PRIORITY_HIGH
    )

    return () => {
      unregisterArrowDown()
      unregisterArrowUp()
      unregisterEnter()
      unregisterTab()
    }
  }, [editor, props])

  return null
}

function readInlineTokenArrowOffset(direction: 'left' | 'right'): number | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null

  const currentOffset = $readSelectionOffsetFromEditorState(0)
  if (direction === 'left' && currentOffset <= 0) return null

  const composerLength = $getRoot().getTextContent().length
  if (direction === 'right' && currentOffset >= composerLength) return null

  const promptValue = $getRoot().getTextContent()
  if (!isCollapsedCursorAdjacentToInlineToken(promptValue, currentOffset, direction)) {
    return null
  }

  return direction === 'left' ? currentOffset - 1 : currentOffset + 1
}

function registerInlineTokenArrowCommand(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  command: typeof KEY_ARROW_LEFT_COMMAND | typeof KEY_ARROW_RIGHT_COMMAND,
  direction: 'left' | 'right'
) {
  return editor.registerCommand(
    command,
    event => {
      let nextOffset: number | null = null
      editor.getEditorState().read(() => {
        nextOffset = readInlineTokenArrowOffset(direction)
      })
      if (nextOffset === null) return false

      event?.preventDefault()
      event?.stopPropagation()
      editor.update(() => {
        $setSelectionAtComposerOffset(nextOffset!)
      })
      return true
    },
    COMMAND_PRIORITY_HIGH
  )
}

export function ComposerInlineTokenArrowPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const unregisterLeft = registerInlineTokenArrowCommand(editor, KEY_ARROW_LEFT_COMMAND, 'left')
    const unregisterRight = registerInlineTokenArrowCommand(
      editor,
      KEY_ARROW_RIGHT_COMMAND,
      'right'
    )
    return () => {
      unregisterLeft()
      unregisterRight()
    }
  }, [editor])

  return null
}

function readInlineTokenSelectionAfterOffset(): number | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
  const anchorNode = selection.anchor.getNode()
  if (!isComposerInlineTokenNode(anchorNode) || selection.anchor.offset === 0) {
    return null
  }
  return getAbsoluteOffsetForPoint(anchorNode, 0) + 1
}

export function ComposerInlineTokenSelectionNormalizePlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      let afterOffset: number | null = null
      editorState.read(() => {
        afterOffset = readInlineTokenSelectionAfterOffset()
      })
      if (afterOffset !== null) {
        queueMicrotask(() => {
          editor.update(() => {
            $setSelectionAtComposerOffset(afterOffset!)
          })
        })
      }
    })
  }, [editor])

  return null
}

function removeInlineTokenNode(
  candidate: unknown,
  selectionOffset: number,
  event: KeyboardEvent | null,
  onRemoveTerminalContext: (contextId: string) => void
): boolean {
  if (!isComposerInlineTokenNode(candidate)) {
    return false
  }
  const tokenStart = getAbsoluteOffsetForPoint(candidate, 0)
  candidate.remove()
  if (candidate instanceof ComposerTerminalContextNode) {
    onRemoveTerminalContext(candidate.__context.id)
    $setSelectionAtComposerOffset(selectionOffset)
  } else {
    $setSelectionAtComposerOffset(tokenStart)
  }
  event?.preventDefault()
  return true
}

function tryRemovePreviousInlineToken(
  anchorNode: LexicalNode,
  anchorOffset: number,
  selectionOffset: number,
  event: KeyboardEvent | null,
  onRemoveTerminalContext: (contextId: string) => void
): boolean {
  if ($isTextNode(anchorNode)) {
    if (anchorNode.getTextContentSize() > 0) {
      return false
    }
    if (
      removeInlineTokenNode(
        anchorNode.getPreviousSibling(),
        selectionOffset,
        event,
        onRemoveTerminalContext
      )
    ) {
      return true
    }
    const parent = anchorNode.getParent()
    if ($isElementNode(parent)) {
      const index = anchorNode.getIndexWithinParent()
      if (index > 0) {
        return removeInlineTokenNode(
          parent.getChildAtIndex(index - 1),
          selectionOffset,
          event,
          onRemoveTerminalContext
        )
      }
    }
    return false
  }

  if ($isElementNode(anchorNode)) {
    return removeInlineTokenNode(
      anchorNode.getChildAtIndex(anchorOffset - 1),
      selectionOffset,
      event,
      onRemoveTerminalContext
    )
  }

  return false
}

export function ComposerInlineTokenBackspacePlugin() {
  const [editor] = useLexicalComposerContext()
  const { onRemoveTerminalContext } = useContext(ComposerTerminalContextActionsContext)

  useEffect(() => {
    return editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      event => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false
        }

        const anchorNode = selection.anchor.getNode()
        const selectionOffset = $readSelectionOffsetFromEditorState(0)
        if (removeInlineTokenNode(anchorNode, selectionOffset, event, onRemoveTerminalContext)) {
          return true
        }
        return tryRemovePreviousInlineToken(
          anchorNode,
          selection.anchor.offset,
          selectionOffset,
          event,
          onRemoveTerminalContext
        )
      },
      COMMAND_PRIORITY_HIGH
    )
  }, [editor, onRemoveTerminalContext])

  return null
}
