import { LexicalComposer, type InitialConfigType } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { forwardRef, useMemo, useRef, type ClipboardEventHandler, type Ref } from 'react'

import { cn } from '~/lib/utils'
import { type TerminalContextDraft } from '~/lib/terminalContext'

import {
  ComposerMentionNode,
  ComposerTerminalContextActionsContext,
  ComposerTerminalContextNode,
} from './ComposerPromptEditor.nodes'
import {
  ComposerCommandKeyPlugin,
  ComposerInlineTokenArrowPlugin,
  ComposerInlineTokenBackspacePlugin,
  ComposerInlineTokenSelectionNormalizePlugin,
} from './ComposerPromptEditor.plugins'
import { $setComposerEditorPrompt } from './ComposerPromptEditor.selection'
import { useComposerPromptEditorController } from './ComposerPromptEditor.logic'

const COMPOSER_EDITOR_HMR_KEY = `composer-editor-${Math.random().toString(36).slice(2)}`

export interface ComposerPromptEditorHandle {
  focus: () => void
  focusAt: (cursor: number) => void
  focusAtEnd: () => void
  readSnapshot: () => {
    value: string
    cursor: number
    expandedCursor: number
    terminalContextIds: string[]
  }
}

interface ComposerPromptEditorProps {
  value: string
  cursor: number
  terminalContexts: ReadonlyArray<TerminalContextDraft>
  disabled: boolean
  placeholder: string
  className?: string
  onRemoveTerminalContext: (contextId: string) => void
  onChange: (
    nextValue: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
    terminalContextIds: string[]
  ) => void
  onCommandKeyDown?: (
    key: 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Tab',
    event: KeyboardEvent
  ) => boolean
  onPaste: ClipboardEventHandler<HTMLElement>
}

interface ComposerPromptEditorInnerProps extends ComposerPromptEditorProps {
  editorRef: Ref<ComposerPromptEditorHandle>
}

function ComposerEditorSurface(
  props: Pick<
    ComposerPromptEditorProps,
    'className' | 'onPaste' | 'placeholder' | 'terminalContexts'
  >
) {
  return (
    <PlainTextPlugin
      contentEditable={
        <ContentEditable
          className={cn(
            'block max-h-[200px] min-h-17.5 w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent text-[14px] leading-relaxed text-foreground focus:outline-none max-sm:text-[16px]',
            props.className
          )}
          data-testid="composer-editor"
          aria-placeholder={props.placeholder}
          placeholder={<span />}
          onPaste={props.onPaste}
        />
      }
      placeholder={
        props.terminalContexts.length > 0 ? null : (
          <div className="pointer-events-none absolute inset-0 text-[14px] leading-relaxed text-muted-foreground/35 max-sm:text-[16px]">
            {props.placeholder}
          </div>
        )
      }
      ErrorBoundary={LexicalErrorBoundary}
    />
  )
}

function ComposerEditorPlugins(
  props: Pick<ComposerPromptEditorProps, 'onCommandKeyDown'> & {
    handleEditorChange: Parameters<typeof OnChangePlugin>[0]['onChange']
  }
) {
  return (
    <>
      <OnChangePlugin onChange={props.handleEditorChange} />
      <ComposerCommandKeyPlugin
        {...(props.onCommandKeyDown ? { onCommandKeyDown: props.onCommandKeyDown } : {})}
      />
      <ComposerInlineTokenArrowPlugin />
      <ComposerInlineTokenSelectionNormalizePlugin />
      <ComposerInlineTokenBackspacePlugin />
      <HistoryPlugin />
    </>
  )
}

function ComposerPromptEditorInner({
  value,
  cursor,
  terminalContexts,
  disabled,
  placeholder,
  className,
  onRemoveTerminalContext,
  onChange,
  onCommandKeyDown,
  onPaste,
  editorRef,
}: ComposerPromptEditorInnerProps) {
  const [editor] = useLexicalComposerContext()
  const { handleEditorChange, terminalContextActions } = useComposerPromptEditorController({
    cursor,
    disabled,
    editor,
    editorRef,
    onChange,
    onRemoveTerminalContext,
    terminalContexts,
    value,
  })

  return (
    <ComposerTerminalContextActionsContext.Provider value={terminalContextActions}>
      <div className="relative">
        <ComposerEditorSurface
          onPaste={onPaste}
          placeholder={placeholder}
          terminalContexts={terminalContexts}
          {...(className ? { className } : {})}
        />
        <ComposerEditorPlugins
          handleEditorChange={handleEditorChange}
          {...(onCommandKeyDown ? { onCommandKeyDown } : {})}
        />
      </div>
    </ComposerTerminalContextActionsContext.Provider>
  )
}

export const ComposerPromptEditor = forwardRef<
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps
>(function ComposerPromptEditor(
  {
    value,
    cursor,
    terminalContexts,
    disabled,
    placeholder,
    className,
    onRemoveTerminalContext,
    onChange,
    onCommandKeyDown,
    onPaste,
  },
  ref
) {
  const initialValueRef = useRef(value)
  const initialTerminalContextsRef = useRef(terminalContexts)
  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: 'orxa-code-composer-editor',
      editable: true,
      nodes: [ComposerMentionNode, ComposerTerminalContextNode],
      editorState: () => {
        $setComposerEditorPrompt(initialValueRef.current, initialTerminalContextsRef.current)
      },
      onError: error => {
        throw error
      },
    }),
    []
  )

  return (
    <LexicalComposer key={COMPOSER_EDITOR_HMR_KEY} initialConfig={initialConfig}>
      <ComposerPromptEditorInner
        value={value}
        cursor={cursor}
        terminalContexts={terminalContexts}
        disabled={disabled}
        placeholder={placeholder}
        onRemoveTerminalContext={onRemoveTerminalContext}
        onChange={onChange}
        onPaste={onPaste}
        editorRef={ref}
        {...(onCommandKeyDown ? { onCommandKeyDown } : {})}
        {...(className ? { className } : {})}
      />
    </LexicalComposer>
  )
})
