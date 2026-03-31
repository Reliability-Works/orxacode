import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { ProjectFileDocument, ProjectFileEntry } from '@shared/ipc'
import Prism from 'prismjs'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-typescript'
import 'prismjs/themes/prism-tomorrow.css'

export type LineSelection = {
  startLine: number
  endLine: number
  top: number
  left: number
  anchorTop: number
  anchorBottom: number
  clamped: boolean
}

export type EditablePreviewState = {
  content: string
  savedContent: string
  dirty: boolean
  saving: boolean
}

type UseProjectFilePreviewOptions = {
  directory: string
  onStatus: (message: string) => void
}

function extensionOf(name: string) {
  const index = name.lastIndexOf('.')
  if (index < 0 || index === name.length - 1) {
    return 'file'
  }
  return name.slice(index + 1).toLowerCase()
}

function languageFromPath(relativePath: string) {
  const ext = extensionOf(relativePath)
  if (ext === 'ts' || ext === 'tsx') return 'typescript'
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'javascript'
  if (ext === 'json' || ext === 'jsonc') return 'json'
  if (ext === 'md' || ext === 'mdx') return 'markdown'
  if (ext === 'css' || ext === 'scss') return 'css'
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'bash'
  if (ext === 'sql') return 'sql'
  return 'none'
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function lineFromNode(node: Node | null): number | undefined {
  let current: Node | null = node
  while (current) {
    if (current instanceof Element) {
      const holder = current.closest<HTMLElement>('[data-line-number]')
      if (holder) {
        const value = Number.parseInt(holder.dataset.lineNumber ?? '', 10)
        return Number.isFinite(value) ? value : undefined
      }
      return undefined
    }
    current = current.parentNode as Node | null
  }
  return undefined
}

function usePreviewDismissKeyboard(
  preview: ProjectFileDocument | null,
  isEditing: boolean,
  setPreview: Dispatch<SetStateAction<ProjectFileDocument | null>>,
  setSelection: Dispatch<SetStateAction<LineSelection | null>>
) {
  useEffect(() => {
    if (!preview) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelection(null)
        if (!isEditing) {
          setPreview(null)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isEditing, preview, setPreview, setSelection])
}

function useSelectionChangeCapture(
  preview: ProjectFileDocument | null,
  isEditing: boolean,
  captureSelection: () => void
) {
  useEffect(() => {
    if (!preview || isEditing) {
      return
    }

    let timerId: ReturnType<typeof setTimeout> | null = null
    const scheduleSelectionCapture = () => {
      if (timerId !== null) {
        clearTimeout(timerId)
      }
      timerId = setTimeout(() => {
        timerId = null
        captureSelection()
      }, 300)
    }

    document.addEventListener('selectionchange', scheduleSelectionCapture)
    return () => {
      document.removeEventListener('selectionchange', scheduleSelectionCapture)
      if (timerId !== null) {
        clearTimeout(timerId)
      }
    }
  }, [captureSelection, isEditing, preview])
}

function useSelectionClamping(
  selection: LineSelection | null,
  previewScrollerRef: RefObject<HTMLDivElement | null>,
  selectionPopoverRef: RefObject<HTMLDivElement | null>,
  setSelection: Dispatch<SetStateAction<LineSelection | null>>
) {
  useLayoutEffect(() => {
    if (!selection || selection.clamped) {
      return
    }

    const root = previewScrollerRef.current
    const popover = selectionPopoverRef.current
    if (!root || !popover) {
      return
    }

    const minLeft = root.scrollLeft + 8
    const minTop = root.scrollTop + 8
    const maxLeft = root.scrollLeft + root.clientWidth - popover.offsetWidth - 8
    const maxTop = root.scrollTop + root.clientHeight - popover.offsetHeight - 8
    const preferredTop = selection.anchorTop - popover.offsetHeight - 8
    const fallbackTop = selection.anchorBottom + 8
    const targetTop = preferredTop >= minTop ? preferredTop : fallbackTop
    const clampedLeft = Math.min(Math.max(selection.left, minLeft), Math.max(minLeft, maxLeft))
    const clampedTop = Math.min(Math.max(targetTop, minTop), Math.max(minTop, maxTop))

    setSelection(current => current ? { ...current, left: clampedLeft, top: clampedTop, clamped: true } : current)
  }, [selection, previewScrollerRef, selectionPopoverRef, setSelection])
}

function usePreviewSaveShortcut(
  preview: ProjectFileDocument | null,
  isEditing: boolean,
  savePreview: () => Promise<void>
) {
  useEffect(() => {
    if (!preview || !isEditing) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const isSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's'
      if (isSave) {
        event.preventDefault()
        void savePreview()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isEditing, preview, savePreview])
}

function useProjectFileDocument({ directory, onStatus }: UseProjectFilePreviewOptions) {
  const [preview, setPreview] = useState<ProjectFileDocument | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    setPreview(null)
    setIsEditing(false)
  }, [directory])

  const previewLanguage = useMemo(
    () => (preview ? languageFromPath(preview.relativePath) : 'none'),
    [preview]
  )
  const previewHtmlLines = useMemo(() => {
    if (!preview) {
      return []
    }

    const source = preview.content ?? ''
    if (preview.binary || previewLanguage === 'none') {
      return escapeHtml(source).split('\n')
    }

    const grammar = Prism.languages[previewLanguage]
    return grammar ? Prism.highlight(source, grammar, previewLanguage).split('\n') : escapeHtml(source).split('\n')
  }, [preview, previewLanguage])

  const openFile = useCallback(async (entry: ProjectFileEntry) => {
    try {
      const document = await window.orxa.opencode.readProjectFile(directory, entry.relativePath)
      setPreview(document)
      const editable = !document.binary && !document.truncated
      setIsEditing(editable)
      return {
        content: document.content ?? '',
        savedContent: document.content ?? '',
        dirty: false,
        saving: false,
      } satisfies EditablePreviewState
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [directory, onStatus])

  return { canEditPreview: Boolean(preview && !preview.binary && !preview.truncated), isEditing, openFile, preview, previewHtmlLines, previewLanguage, setPreview }
}

function useProjectFileSelection(
  preview: ProjectFileDocument | null,
  isEditing: boolean,
  onStatus: (message: string) => void
) {
  const [selection, setSelection] = useState<LineSelection | null>(null)
  const [copiedField, setCopiedField] = useState<'path' | 'selection' | null>(null)
  const previewScrollerRef = useRef<HTMLDivElement | null>(null)
  const selectionPopoverRef = useRef<HTMLDivElement | null>(null)

  const captureSelection = useCallback((event?: React.MouseEvent<HTMLDivElement>) => {
    const target = event?.target
    if (target instanceof Element && target.closest('.file-preview-selection-popover')) {
      return
    }

    const root = previewScrollerRef.current
    if (!root || !preview) {
      return
    }

    const browserSelection = window.getSelection()
    if (!browserSelection || browserSelection.rangeCount === 0 || browserSelection.isCollapsed) {
      setSelection(null)
      return
    }

    const range = browserSelection.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) {
      setSelection(null)
      return
    }

    const start = lineFromNode(browserSelection.anchorNode)
    const end = lineFromNode(browserSelection.focusNode)
    if (!start || !end) {
      setSelection(null)
      return
    }

    const bounds = range.getBoundingClientRect()
    const rootBounds = root.getBoundingClientRect()
    setSelection({
      startLine: Math.min(start, end),
      endLine: Math.max(start, end),
      top: Math.max(8, bounds.top - rootBounds.top + root.scrollTop - 40),
      left: Math.max(8, bounds.right - rootBounds.left + root.scrollLeft + 8),
      anchorTop: bounds.top - rootBounds.top + root.scrollTop,
      anchorBottom: bounds.bottom - rootBounds.top + root.scrollTop,
      clamped: false,
    })
  }, [preview])

  const copyPreviewPath = useCallback(() => {
    if (!preview) {
      return
    }
    void navigator.clipboard.writeText(preview.path).then(() => {
      setCopiedField('path')
      onStatus(`Copied to clipboard: ${preview.relativePath}`)
      setTimeout(() => setCopiedField(null), 1500)
    })
  }, [onStatus, preview])

  const copySelectionReference = useCallback(() => {
    if (!preview || !selection) {
      return
    }
    const lineRef =
      selection.startLine === selection.endLine
        ? `${preview.relativePath}:${selection.startLine}`
        : `${preview.relativePath}:${selection.startLine}-${selection.endLine}`
    void navigator.clipboard.writeText(lineRef).then(() => {
      setCopiedField('selection')
      onStatus(`Copied to clipboard: ${lineRef}`)
      setTimeout(() => {
        setCopiedField(null)
        setSelection(null)
        window.getSelection()?.removeAllRanges()
      }, 1200)
    })
  }, [onStatus, preview, selection])

  useEffect(() => {
    setSelection(null)
    setCopiedField(null)
  }, [preview])

  useSelectionChangeCapture(preview, isEditing, () => captureSelection())
  useSelectionClamping(selection, previewScrollerRef, selectionPopoverRef, setSelection)

  return {
    captureSelection,
    copiedField,
    copyPreviewPath,
    copySelectionReference,
    previewScrollerRef,
    selection,
    selectionPopoverRef,
    setCopiedField,
    setSelection,
  }
}

function useProjectFileEditing(
  preview: ProjectFileDocument | null,
  setPreview: Dispatch<SetStateAction<ProjectFileDocument | null>>,
  onStatus: (message: string) => void
) {
  const [editorState, setEditorState] = useState<EditablePreviewState | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    setEditorState(preview ? {
      content: preview.content ?? '',
      savedContent: preview.content ?? '',
      dirty: false,
      saving: false,
    } : null)
  }, [preview])

  const savePreview = useCallback(async () => {
    if (!preview || !editorState || editorState.saving || !editorState.dirty) {
      return
    }
    setEditorState(current => current ? { ...current, saving: true } : current)
    try {
      await window.orxa.app.writeTextFile(preview.path, editorState.content)
      setPreview(current => current ? { ...current, content: editorState.content, truncated: false, binary: false } : current)
      setEditorState({
        content: editorState.content,
        savedContent: editorState.content,
        dirty: false,
        saving: false,
      })
      onStatus(`Saved ${preview.relativePath}`)
    } catch (error) {
      setEditorState(current => current ? { ...current, saving: false } : current)
      onStatus(error instanceof Error ? error.message : String(error))
    }
  }, [editorState, onStatus, preview, setPreview])

  const undoPreviewChanges = useCallback(() => {
    setEditorState(current =>
      current ? { ...current, content: current.savedContent, dirty: false } : current
    )
    editorRef.current?.focus()
  }, [])

  usePreviewSaveShortcut(preview, Boolean(preview && !preview.binary && !preview.truncated), savePreview)

  return { editorRef, editorState, savePreview, setEditorState, undoPreviewChanges }
}

export function useProjectFilePreview({ directory, onStatus }: UseProjectFilePreviewOptions) {
  const document = useProjectFileDocument({ directory, onStatus })
  const selection = useProjectFileSelection(document.preview, document.isEditing, onStatus)
  const editing = useProjectFileEditing(document.preview, document.setPreview, onStatus)

  usePreviewDismissKeyboard(
    document.preview,
    document.isEditing,
    document.setPreview,
    selection.setSelection
  )

  return {
    canEditPreview: document.canEditPreview,
    captureSelection: selection.captureSelection,
    closePreview: () => document.setPreview(null),
    copiedField: selection.copiedField,
    copyPreviewPath: selection.copyPreviewPath,
    copySelectionReference: selection.copySelectionReference,
    editorRef: editing.editorRef,
    editorState: editing.editorState,
    isEditing: document.isEditing,
    openFile: async (entry: ProjectFileEntry) => {
      const nextEditorState = await document.openFile(entry)
      selection.setSelection(null)
      if (nextEditorState) {
        editing.setEditorState(nextEditorState)
      }
    },
    preview: document.preview,
    previewHtmlLines: document.previewHtmlLines,
    previewLanguage: document.previewLanguage,
    previewScrollerRef: selection.previewScrollerRef,
    savePreview: editing.savePreview,
    selection: selection.selection,
    selectionPopoverRef: selection.selectionPopoverRef,
    setCopiedField: selection.setCopiedField,
    setEditorState: editing.setEditorState,
    setSelection: selection.setSelection,
    undoPreviewChanges: editing.undoPreviewChanges,
  }
}
