import { type LexicalEditor, $getRoot, type EditorState } from 'lexical'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ContextType,
  type MutableRefObject,
  type Ref,
} from 'react'

import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
  isCollapsedCursorAdjacentToInlineToken,
} from '~/composer-logic'
import { type TerminalContextDraft } from '~/lib/terminalContext'

import { type ComposerPromptEditorHandle } from './ComposerPromptEditor'
import { ComposerTerminalContextActionsContext } from './ComposerPromptEditor.nodes'
import {
  $readExpandedSelectionOffsetFromEditorState,
  $readSelectionOffsetFromEditorState,
  $setComposerEditorPrompt,
  $setSelectionAtComposerOffset,
  clampExpandedCursor,
  collectTerminalContextIds,
  terminalContextSignature,
} from './ComposerPromptEditor.selection'

type EditorSnapshot = {
  cursor: number
  expandedCursor: number
  terminalContextIds: string[]
  value: string
}

type ComposerPromptEditorControllerInput = {
  cursor: number
  disabled: boolean
  editor: LexicalEditor
  editorRef: Ref<ComposerPromptEditorHandle>
  onChange: (
    nextValue: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
    terminalContextIds: string[]
  ) => void
  onRemoveTerminalContext: (contextId: string) => void
  terminalContexts: ReadonlyArray<TerminalContextDraft>
  value: string
}

function createEditorSnapshot(
  value: string,
  cursor: number,
  terminalContexts: ReadonlyArray<TerminalContextDraft>
): EditorSnapshot {
  const normalizedCursor = clampCollapsedComposerCursor(value, cursor)
  return {
    value,
    cursor: normalizedCursor,
    expandedCursor: expandCollapsedComposerCursor(value, normalizedCursor),
    terminalContextIds: terminalContexts.map(context => context.id),
  }
}

function readEditorSnapshot(editor: LexicalEditor, fallback: EditorSnapshot): EditorSnapshot {
  let snapshot = fallback
  editor.getEditorState().read(() => {
    const nextValue = $getRoot().getTextContent()
    const fallbackCursor = clampCollapsedComposerCursor(nextValue, fallback.cursor)
    const nextCursor = clampCollapsedComposerCursor(
      nextValue,
      $readSelectionOffsetFromEditorState(fallbackCursor)
    )
    const fallbackExpandedCursor = clampExpandedCursor(nextValue, fallback.expandedCursor)
    const nextExpandedCursor = clampExpandedCursor(
      nextValue,
      $readExpandedSelectionOffsetFromEditorState(fallbackExpandedCursor)
    )
    snapshot = {
      value: nextValue,
      cursor: nextCursor,
      expandedCursor: nextExpandedCursor,
      terminalContextIds: collectTerminalContextIds($getRoot()),
    }
  })
  return snapshot
}

function snapshotsMatch(left: EditorSnapshot, right: EditorSnapshot): boolean {
  return (
    left.value === right.value &&
    left.cursor === right.cursor &&
    left.expandedCursor === right.expandedCursor &&
    left.terminalContextIds.length === right.terminalContextIds.length &&
    left.terminalContextIds.every((id, index) => id === right.terminalContextIds[index])
  )
}

function useControlledEditorSync(input: {
  cursor: number
  editor: LexicalEditor
  isApplyingControlledUpdateRef: MutableRefObject<boolean>
  snapshotRef: MutableRefObject<EditorSnapshot>
  terminalContexts: ReadonlyArray<TerminalContextDraft>
  terminalContextsSignature: string
  terminalContextsSignatureRef: MutableRefObject<string>
  value: string
}) {
  useLayoutEffect(() => {
    const snapshotRef = input.snapshotRef
    const signatureRef = input.terminalContextsSignatureRef
    const isApplyingControlledUpdateRef = input.isApplyingControlledUpdateRef
    const normalizedCursor = clampCollapsedComposerCursor(input.value, input.cursor)
    const previousSnapshot = snapshotRef.current
    const contextsChanged = signatureRef.current !== input.terminalContextsSignature
    if (
      previousSnapshot.value === input.value &&
      previousSnapshot.cursor === normalizedCursor &&
      !contextsChanged
    ) {
      return
    }

    snapshotRef.current = createEditorSnapshot(
      input.value,
      normalizedCursor,
      input.terminalContexts
    )
    signatureRef.current = input.terminalContextsSignature

    const rootElement = input.editor.getRootElement()
    const isFocused = Boolean(rootElement && document.activeElement === rootElement)
    if (previousSnapshot.value === input.value && !contextsChanged && !isFocused) {
      return
    }

    isApplyingControlledUpdateRef.current = true
    input.editor.update(() => {
      const shouldRewriteEditorState = previousSnapshot.value !== input.value || contextsChanged
      if (shouldRewriteEditorState) {
        $setComposerEditorPrompt(input.value, input.terminalContexts)
      }
      if (shouldRewriteEditorState || isFocused) {
        $setSelectionAtComposerOffset(normalizedCursor)
      }
    })
    queueMicrotask(() => {
      isApplyingControlledUpdateRef.current = false
    })
  }, [
    input.cursor,
    input.editor,
    input.isApplyingControlledUpdateRef,
    input.snapshotRef,
    input.terminalContexts,
    input.terminalContextsSignature,
    input.terminalContextsSignatureRef,
    input.value,
  ])
}

function useComposerFocusHandle(input: {
  editor: LexicalEditor
  editorRef: Ref<ComposerPromptEditorHandle>
  onChangeRef: MutableRefObject<ComposerPromptEditorControllerInput['onChange']>
  snapshotRef: MutableRefObject<EditorSnapshot>
}) {
  const { editor, editorRef, onChangeRef, snapshotRef } = input

  const focusAt = useCallback(
    (nextCursor: number) => {
      const rootElement = editor.getRootElement()
      if (!rootElement) return

      const boundedCursor = clampCollapsedComposerCursor(snapshotRef.current.value, nextCursor)
      rootElement.focus()
      editor.update(() => {
        $setSelectionAtComposerOffset(boundedCursor)
      })
      snapshotRef.current = {
        ...snapshotRef.current,
        cursor: boundedCursor,
        expandedCursor: expandCollapsedComposerCursor(snapshotRef.current.value, boundedCursor),
      }
      onChangeRef.current(
        snapshotRef.current.value,
        boundedCursor,
        snapshotRef.current.expandedCursor,
        false,
        snapshotRef.current.terminalContextIds
      )
    },
    [editor, onChangeRef, snapshotRef]
  )

  const readSnapshot = useCallback(() => {
    const snapshot = readEditorSnapshot(editor, snapshotRef.current)
    snapshotRef.current = snapshot
    return snapshot
  }, [editor, snapshotRef])

  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => {
        focusAt(snapshotRef.current.cursor)
      },
      focusAt,
      focusAtEnd: () => {
        focusAt(
          collapseExpandedComposerCursor(
            snapshotRef.current.value,
            snapshotRef.current.value.length
          )
        )
      },
      readSnapshot,
    }),
    [focusAt, snapshotRef, readSnapshot]
  )

  return { readSnapshot }
}

function useComposerEditorChangeHandler(input: {
  isApplyingControlledUpdateRef: MutableRefObject<boolean>
  onChangeRef: MutableRefObject<ComposerPromptEditorControllerInput['onChange']>
  snapshotRef: MutableRefObject<EditorSnapshot>
}) {
  return useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        const nextValue = $getRoot().getTextContent()
        const fallbackCursor = clampCollapsedComposerCursor(
          nextValue,
          input.snapshotRef.current.cursor
        )
        const nextCursor = clampCollapsedComposerCursor(
          nextValue,
          $readSelectionOffsetFromEditorState(fallbackCursor)
        )
        const fallbackExpandedCursor = clampExpandedCursor(
          nextValue,
          input.snapshotRef.current.expandedCursor
        )
        const nextExpandedCursor = clampExpandedCursor(
          nextValue,
          $readExpandedSelectionOffsetFromEditorState(fallbackExpandedCursor)
        )
        const nextSnapshot: EditorSnapshot = {
          value: nextValue,
          cursor: nextCursor,
          expandedCursor: nextExpandedCursor,
          terminalContextIds: collectTerminalContextIds($getRoot()),
        }
        if (snapshotsMatch(input.snapshotRef.current, nextSnapshot)) {
          return
        }
        if (input.isApplyingControlledUpdateRef.current) {
          return
        }
        input.snapshotRef.current = nextSnapshot
        const cursorAdjacentToMention =
          isCollapsedCursorAdjacentToInlineToken(nextValue, nextCursor, 'left') ||
          isCollapsedCursorAdjacentToInlineToken(nextValue, nextCursor, 'right')
        input.onChangeRef.current(
          nextValue,
          nextCursor,
          nextExpandedCursor,
          cursorAdjacentToMention,
          nextSnapshot.terminalContextIds
        )
      })
    },
    [input.isApplyingControlledUpdateRef, input.onChangeRef, input.snapshotRef]
  )
}

export function useComposerPromptEditorController(input: ComposerPromptEditorControllerInput): {
  handleEditorChange: (editorState: EditorState) => void
  terminalContextActions: ContextType<typeof ComposerTerminalContextActionsContext>
} {
  const onChangeRef = useRef(input.onChange)
  const terminalContextsSignatureRef = useRef(terminalContextSignature(input.terminalContexts))
  const snapshotRef = useRef(
    createEditorSnapshot(input.value, input.cursor, input.terminalContexts)
  )
  const isApplyingControlledUpdateRef = useRef(false)
  const terminalContextActions = useMemo(
    () => ({ onRemoveTerminalContext: input.onRemoveTerminalContext }),
    [input.onRemoveTerminalContext]
  )

  useEffect(() => {
    onChangeRef.current = input.onChange
  }, [input.onChange])

  useEffect(() => {
    input.editor.setEditable(!input.disabled)
  }, [input.disabled, input.editor])

  const terminalContextsSignatureValue = terminalContextSignature(input.terminalContexts)
  useControlledEditorSync({
    cursor: input.cursor,
    editor: input.editor,
    isApplyingControlledUpdateRef,
    snapshotRef,
    terminalContexts: input.terminalContexts,
    terminalContextsSignature: terminalContextsSignatureValue,
    terminalContextsSignatureRef,
    value: input.value,
  })
  useComposerFocusHandle({
    editor: input.editor,
    editorRef: input.editorRef,
    onChangeRef,
    snapshotRef,
  })

  const handleEditorChange = useComposerEditorChangeHandler({
    isApplyingControlledUpdateRef,
    onChangeRef,
    snapshotRef,
  })

  return { handleEditorChange, terminalContextActions }
}
