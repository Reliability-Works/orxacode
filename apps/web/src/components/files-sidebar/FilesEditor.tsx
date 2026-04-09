import { SaveIcon, ExternalLinkIcon } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'

import { ensureNativeApi } from '../../nativeApi'
import { openInPreferredEditor } from '../../editorPreferences'
import { useTheme } from '../../hooks/useTheme'
import { resolveFileEditorLanguage } from './fileLanguage'
import { Button } from '../ui/button'
import { VscodeEntryIcon } from '../chat/VscodeEntryIcon'
import { toastManager } from '../ui/toastState'

export interface FilesEditorProps {
  cwd: string
  filePath: string | null
  contents: string
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  errorMessage: string | null
  onChange: (nextContents: string) => void
  onSave: () => void
}

function FilesEditorEmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
      Select a file to open it in the editor.
    </div>
  )
}

function FilesEditorHeader(props: {
  cwd: string
  filePath: string
  isDirty: boolean
  isSaving: boolean
  onSave: () => void
}) {
  const { resolvedTheme } = useTheme()

  const handleOpenExternally = async () => {
    try {
      await openInPreferredEditor(ensureNativeApi(), `${props.cwd}/${props.filePath}`)
    } catch (error) {
      toastManager.add({
        type: 'error',
        title: 'Could not open file in editor',
        description: error instanceof Error ? error.message : 'Open in editor failed.',
      })
    }
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <VscodeEntryIcon pathValue={props.filePath} kind="file" theme={resolvedTheme} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">{props.filePath}</div>
      </div>
      {props.isDirty ? <span className="size-2 rounded-full bg-primary" /> : null}
      <Button
        size="xs"
        variant="ghost"
        onClick={handleOpenExternally}
        aria-label="Open in preferred editor"
        className="h-6 w-6 p-0"
      >
        <ExternalLinkIcon className="size-3.5" />
      </Button>
      <Button
        size="xs"
        variant={props.isDirty ? 'default' : 'outline'}
        onClick={props.onSave}
        disabled={!props.isDirty || props.isSaving}
        className="gap-1.5"
      >
        <SaveIcon className="size-3.5" />
        {props.isSaving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}

function FilesEditorErrorState(props: { errorMessage: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-xs text-destructive">
      {props.errorMessage}
    </div>
  )
}

function FilesEditorLoadingState() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
      Loading editor…
    </div>
  )
}

const EDITOR_FONT_FAMILY =
  "'SF Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"

const SYNTAX_LANGUAGE_ALIASES: Record<string, string> = {
  bat: 'batch',
  cpp: 'cpp',
  csharp: 'csharp',
  dockerfile: 'docker',
  html: 'markup',
  javascript: 'javascript',
  json: 'json',
  markdown: 'markdown',
  'objective-c': 'objectivec',
  plaintext: 'text',
  powershell: 'powershell',
  shell: 'bash',
  sql: 'sql',
  typescript: 'typescript',
  xml: 'markup',
  yaml: 'yaml',
}

function resolveSyntaxHighlightLanguage(pathValue: string): string {
  const language = resolveFileEditorLanguage(pathValue)
  return SYNTAX_LANGUAGE_ALIASES[language] ?? language
}

function useEditorScrollSync() {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const highlightRef = useRef<HTMLDivElement | null>(null)
  const lineNumbersRef = useRef<HTMLPreElement | null>(null)

  const syncScrollOffsets = useCallback((input: HTMLTextAreaElement | null) => {
    if (!input) return
    if (highlightRef.current) {
      highlightRef.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`
    }
    if (lineNumbersRef.current) {
      lineNumbersRef.current.style.transform = `translateY(${-input.scrollTop}px)`
    }
  }, [])

  return { highlightRef, lineNumbersRef, syncScrollOffsets, textareaRef }
}

function FilesEditorGutter({
  lineNumbers,
  lineNumbersRef,
}: {
  lineNumbers: string
  lineNumbersRef: RefObject<HTMLPreElement | null>
}) {
  return (
    <div className="relative w-12 shrink-0 overflow-hidden border-r border-border bg-muted/20">
      <pre
        ref={lineNumbersRef}
        className="m-0 px-2 py-3 text-right font-mono text-[12px] leading-5 text-muted-foreground will-change-transform"
      >
        {lineNumbers}
      </pre>
    </div>
  )
}

function HighlightedCodeLayer({
  contents,
  highlightRef,
  syntaxLanguage,
}: {
  contents: string
  highlightRef: RefObject<HTMLDivElement | null>
  syntaxLanguage: string
}) {
  const { resolvedTheme } = useTheme()

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div ref={highlightRef} className="min-h-full min-w-full w-max will-change-transform">
        <SyntaxHighlighter
          language={syntaxLanguage}
          style={resolvedTheme === 'dark' ? vscDarkPlus : vs}
          PreTag="div"
          wrapLongLines={false}
          customStyle={{
            background: 'transparent',
            margin: 0,
            minHeight: '100%',
            minWidth: '100%',
            overflow: 'visible',
            padding: '12px',
            width: 'max-content',
          }}
          codeTagProps={{
            style: {
              display: 'block',
              fontFamily: EDITOR_FONT_FAMILY,
              fontSize: '12px',
              lineHeight: '20px',
              minHeight: '100%',
              whiteSpace: 'pre',
            },
          }}
        >
          {contents.length > 0 ? contents : ' '}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}

function EditorTextarea({
  contents,
  onChange,
  onSave,
  syncScrollOffsets,
  textareaRef,
}: {
  contents: string
  onChange: (nextContents: string) => void
  onSave: () => void
  syncScrollOffsets: (input: HTMLTextAreaElement | null) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
}) {
  return (
    <textarea
      ref={textareaRef}
      value={contents}
      spellCheck={false}
      wrap="off"
      data-testid="files-editor-surface"
      onChange={event => onChange(event.target.value)}
      onScroll={event => syncScrollOffsets(event.currentTarget)}
      onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          onSave()
        }
      }}
      className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent px-3 py-3 font-mono text-[12px] leading-5 text-transparent caret-foreground outline-none selection:bg-primary/25"
      style={{
        fontFamily: EDITOR_FONT_FAMILY,
        WebkitTextFillColor: 'transparent',
      }}
    />
  )
}

function CodeEditorSurface(props: {
  filePath: string
  contents: string
  isLoading: boolean
  onChange: (nextContents: string) => void
  onSave: () => void
}) {
  const { highlightRef, lineNumbersRef, syncScrollOffsets, textareaRef } = useEditorScrollSync()
  const syntaxLanguage = useMemo(
    () => resolveSyntaxHighlightLanguage(props.filePath),
    [props.filePath]
  )
  const lineNumbers = useMemo(() => {
    const count = Math.max(1, props.contents.split('\n').length)
    return Array.from({ length: count }, (_, index) => index + 1).join('\n')
  }, [props.contents])

  useEffect(() => {
    syncScrollOffsets(textareaRef.current)
  }, [props.contents, props.filePath, syncScrollOffsets, textareaRef])

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
      <div className="flex h-full min-w-0 bg-background">
        <FilesEditorGutter lineNumbers={lineNumbers} lineNumbersRef={lineNumbersRef} />
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
          <HighlightedCodeLayer
            contents={props.contents}
            highlightRef={highlightRef}
            syntaxLanguage={syntaxLanguage}
          />
          <EditorTextarea
            contents={props.contents}
            onChange={props.onChange}
            onSave={props.onSave}
            syncScrollOffsets={syncScrollOffsets}
            textareaRef={textareaRef}
          />
        </div>
      </div>
      {props.isLoading ? <FilesEditorLoadingState /> : null}
    </div>
  )
}

export function FilesEditor(props: FilesEditorProps) {
  if (!props.filePath) {
    return <FilesEditorEmptyState />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilesEditorHeader
        cwd={props.cwd}
        filePath={props.filePath}
        isDirty={props.isDirty}
        isSaving={props.isSaving}
        onSave={props.onSave}
      />
      {props.errorMessage ? <FilesEditorErrorState errorMessage={props.errorMessage} /> : null}
      {!props.errorMessage ? (
        <CodeEditorSurface
          filePath={props.filePath}
          contents={props.contents}
          isLoading={props.isLoading}
          onChange={props.onChange}
          onSave={props.onSave}
        />
      ) : null}
    </div>
  )
}
