import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MutableRefObject } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react'
import { getFileIcon } from '../../lib/file-icons'
import type { ProjectFileEntry } from '@shared/ipc'
import { CanvasTileComponent } from '../CanvasTile'
import { tilePathBasename, type CanvasTileComponentProps } from './tile-shared'

type FileEditorTileProps = CanvasTileComponentProps

const PLACEHOLDER = '// Select a file from the tree to begin editing.'

function FileEntryIcon({ name }: { name: string }) {
  const { icon, color } = getFileIcon(name)
  return <span style={{ color, display: 'inline-flex', flexShrink: 0 }}>{icon}</span>
}

function sortEntries(entries: ProjectFileEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  })
}

type TreeState = Record<string, ProjectFileEntry[]>

export function FileEditorTile({
  tile,
  canvasTheme,
  onUpdate,
  onRemove,
  onBringToFront,
  snapToGrid,
  gridSize,
  allTiles,
  canvasOffsetX,
  canvasOffsetY,
  viewportScale,
}: FileEditorTileProps) {
  const directory = typeof tile.meta.directory === 'string' ? tile.meta.directory : ''
  const filePath = typeof tile.meta.filePath === 'string' ? tile.meta.filePath : ''
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const {
    hasIpc,
    rootEntries,
    treeLoading,
    nodesByPath,
    expanded,
    toggleDirectory,
  } = useProjectFileTree({ directory })

  const selectFile = useCallback(
    (entry: ProjectFileEntry) => {
      const newPath = entry.path
      onUpdate(tile.id, { meta: { ...tile.meta, filePath: newPath } })
    },
    [tile.id, tile.meta, onUpdate]
  )
  const { content, handleChange, lineCount, loadError, loading } = useFileEditorContent({
    directory,
    filePath,
    tile,
    onUpdate,
  })

  const handleScroll = useCallback(() => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  const fileName = tilePathBasename(filePath, 'untitled')
  const metaLabel = filePath ? fileName : 'untitled'

  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1)

  const showTree = directory && hasIpc

  return (
    <CanvasTileComponent
      tile={tile}
      canvasTheme={canvasTheme}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onBringToFront={onBringToFront}
      icon={<FileText size={12} />}
      label="file editor"
      iconColor="#F59E0B"
      metadata={metaLabel}
      snapToGrid={snapToGrid}
      gridSize={gridSize}
      allTiles={allTiles}
      canvasOffsetX={canvasOffsetX}
      canvasOffsetY={canvasOffsetY}
      viewportScale={viewportScale}
    >
      <div className="file-editor-tile-body">
        {showTree && (
          <FileEditorTreePanel
            expanded={expanded}
            filePath={filePath}
            nodesByPath={nodesByPath}
            rootEntries={rootEntries}
            selectFile={selectFile}
            toggleDirectory={toggleDirectory}
            treeLoading={treeLoading}
          />
        )}
        <FileEditorContentPanel
          content={content}
          gutterRef={gutterRef}
          handleChange={handleChange}
          handleScroll={handleScroll}
          lineNumbers={lineNumbers}
          loadError={loadError}
          loading={loading}
          metaLabel={metaLabel}
          textareaRef={textareaRef}
        />
      </div>
    </CanvasTileComponent>
  )
}

function useProjectFileTree({ directory }: { directory: string }) {
  const [nodesByPath, setNodesByPath] = useState<TreeState>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [treeLoading, setTreeLoading] = useState<Record<string, boolean>>({})
  const folderRequestsRef = useRef<Record<string, Promise<ProjectFileEntry[]>>>({})
  const hasIpc = useMemo(
    () => !!((window as Window & typeof globalThis & { orxa?: { opencode?: { listFiles?: unknown } } }).orxa?.opencode?.listFiles),
    []
  )

  const loadFolder = useCallback(
    async (relativePath = '') => {
      if (!hasIpc || !directory) return []
      const existing = folderRequestsRef.current[relativePath]
      if (existing) return existing
      const request = (async () => {
        setTreeLoading(c => ({ ...c, [relativePath]: true }))
        try {
          const entries = await window.orxa.opencode.listFiles(directory, relativePath)
          const sorted = sortEntries(entries)
          setNodesByPath(c => ({ ...c, [relativePath]: sorted }))
          return sorted
        } catch {
          return []
        } finally {
          setTreeLoading(c => ({ ...c, [relativePath]: false }))
          delete folderRequestsRef.current[relativePath]
        }
      })()
      folderRequestsRef.current[relativePath] = request
      return request
    },
    [directory, hasIpc]
  )

  useEffect(() => {
    if (!directory || !hasIpc) return
    setNodesByPath({})
    setExpanded({})
    folderRequestsRef.current = {}
    void loadFolder('')
  }, [directory, hasIpc, loadFolder])

  const toggleDirectory = useCallback(
    (entry: ProjectFileEntry) => {
      setExpanded(c => {
        const next = !c[entry.relativePath]
        if (next) void loadFolder(entry.relativePath)
        return { ...c, [entry.relativePath]: next }
      })
    },
    [loadFolder]
  )

  const rootEntries = useMemo(() => sortEntries(nodesByPath[''] ?? []), [nodesByPath])

  return { expanded, hasIpc, nodesByPath, rootEntries, toggleDirectory, treeLoading }
}

function useFileEditorContent({
  directory,
  filePath,
  tile,
  onUpdate,
}: {
  directory: string
  filePath: string
  tile: FileEditorTileProps['tile']
  onUpdate: FileEditorTileProps['onUpdate']
}) {
  const [content, setContent] = useState<string>('')
  const [lineCount, setLineCount] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const prevFilePathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!filePath || filePath === prevFilePathRef.current) return
    prevFilePathRef.current = filePath
    void loadFileContent({ directory, filePath, setContent, setLineCount, setLoadError, setLoading })
  }, [directory, filePath])

  useEffect(() => {
    if (!filePath && content === '') {
      setContent(PLACEHOLDER)
      setLineCount(PLACEHOLDER.split('\n').length)
    }
  }, [content, filePath])

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value
      setContent(value)
      setLineCount(value.split('\n').length)
      onUpdate(tile.id, { meta: { ...tile.meta, content: value } })
    },
    [onUpdate, tile.id, tile.meta]
  )

  return { content, handleChange, lineCount, loadError, loading }
}

async function loadFileContent({
  directory,
  filePath,
  setContent,
  setLineCount,
  setLoadError,
  setLoading,
}: {
  directory: string
  filePath: string
  setContent: (value: string) => void
  setLineCount: (value: number) => void
  setLoadError: (value: string | null) => void
  setLoading: (value: boolean) => void
}) {
  const orxa = (
    window as Window &
      typeof globalThis & {
        orxa?: {
          opencode?: {
            readProjectFile?: (
              dir: string,
              rel: string
            ) => Promise<{ content: string; binary?: boolean; truncated?: boolean }>
          }
        }
      }
  ).orxa
  if (!orxa?.opencode?.readProjectFile || !directory) {
    await loadFileContentFromFs({ filePath, setContent, setLineCount, setLoadError, setLoading })
    return
  }

  const relative = filePath.startsWith(directory) ? filePath.slice(directory.length).replace(/^\//, '') : filePath
  setLoading(true)
  setLoadError(null)
  orxa.opencode
    .readProjectFile(directory, relative)
    .then(doc => {
      setContent(doc.content ?? '')
      setLineCount((doc.content ?? '').split('\n').length)
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      setLoadError(`Failed to load: ${message}`)
      setContent('')
      setLineCount(1)
    })
    .finally(() => setLoading(false))
}

async function loadFileContentFromFs({
  filePath,
  setContent,
  setLineCount,
  setLoadError,
  setLoading,
}: {
  filePath: string
  setContent: (value: string) => void
  setLineCount: (value: number) => void
  setLoadError: (value: string | null) => void
  setLoading: (value: boolean) => void
}) {
  const fsOrxa = ((window as Window & typeof globalThis & { orxa?: { fs?: { read?: (path: string) => Promise<string> } } }).orxa)
  if (!fsOrxa?.fs?.read) {
    setContent(PLACEHOLDER)
    setLineCount(PLACEHOLDER.split('\n').length)
    return
  }
  setLoading(true)
  setLoadError(null)
  fsOrxa.fs
    .read(filePath)
    .then((text: string) => {
      setContent(text)
      setLineCount(text.split('\n').length)
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      setLoadError(`Failed to load: ${message}`)
      setContent('')
      setLineCount(1)
    })
    .finally(() => setLoading(false))
}

function FileEditorTreePanel({
  expanded,
  filePath,
  nodesByPath,
  rootEntries,
  selectFile,
  toggleDirectory,
  treeLoading,
}: {
  expanded: Record<string, boolean>
  filePath: string
  nodesByPath: TreeState
  rootEntries: ProjectFileEntry[]
  selectFile: (entry: ProjectFileEntry) => void
  toggleDirectory: (entry: ProjectFileEntry) => void
  treeLoading: Record<string, boolean>
}) {
  return (
    <div className="file-editor-tile-tree" data-testid="file-editor-tree">
      <div className="file-editor-tile-tree-scroll">
        {rootEntries.length === 0 && !treeLoading[''] ? (
          <div className="file-editor-tree-loading">No files found.</div>
        ) : null}
        {treeLoading[''] ? (
          <div className="file-editor-tree-loading">Loading...</div>
        ) : (
          <FileEditorTreeRows
            depth={0}
            entries={rootEntries}
            expanded={expanded}
            filePath={filePath}
            nodesByPath={nodesByPath}
            selectFile={selectFile}
            toggleDirectory={toggleDirectory}
            treeLoading={treeLoading}
          />
        )}
      </div>
    </div>
  )
}

function FileEditorTreeRows({
  depth,
  entries,
  expanded,
  filePath,
  nodesByPath,
  selectFile,
  toggleDirectory,
  treeLoading,
}: {
  depth: number
  entries: ProjectFileEntry[]
  expanded: Record<string, boolean>
  filePath: string
  nodesByPath: TreeState
  selectFile: (entry: ProjectFileEntry) => void
  toggleDirectory: (entry: ProjectFileEntry) => void
  treeLoading: Record<string, boolean>
}) {
  return entries.map(entry => (
    <FileEditorTreeRow
      key={entry.relativePath}
      depth={depth}
      entry={entry}
      expanded={expanded}
      filePath={filePath}
      nodesByPath={nodesByPath}
      selectFile={selectFile}
      toggleDirectory={toggleDirectory}
      treeLoading={treeLoading}
    />
  ))
}

function FileEditorTreeRow({
  depth,
  entry,
  expanded,
  filePath,
  nodesByPath,
  selectFile,
  toggleDirectory,
  treeLoading,
}: {
  depth: number
  entry: ProjectFileEntry
  expanded: Record<string, boolean>
  filePath: string
  nodesByPath: TreeState
  selectFile: (entry: ProjectFileEntry) => void
  toggleDirectory: (entry: ProjectFileEntry) => void
  treeLoading: Record<string, boolean>
}) {
  const isDir = entry.type === 'directory'
  const isOpen = !!expanded[entry.relativePath]
  const children = nodesByPath[entry.relativePath] ?? []
  const isTreeLoading = !!treeLoading[entry.relativePath]
  const isActive = entry.path === filePath
  return (
    <div className="file-editor-tree-row-wrap">
      <button
        type="button"
        className={`file-editor-tree-row${isActive ? ' active' : ''}`}
        style={{ paddingLeft: `${6 + depth * 12}px` }}
        onClick={() => (isDir ? toggleDirectory(entry) : selectFile(entry))}
        title={entry.path}
      >
        <FileEditorTreeRowIcon entry={entry} isDir={isDir} isOpen={isOpen} />
        <span className="file-editor-tree-label">{entry.name}</span>
      </button>
      {isDir && isOpen ? (
        <div className="file-editor-tree-children">
          {isTreeLoading ? (
            <div
              className="file-editor-tree-loading"
              style={{ paddingLeft: `${6 + (depth + 1) * 12}px` }}
            >
              Loading...
            </div>
          ) : (
            <FileEditorTreeRows
              depth={depth + 1}
              entries={children}
              expanded={expanded}
              filePath={filePath}
              nodesByPath={nodesByPath}
              selectFile={selectFile}
              toggleDirectory={toggleDirectory}
              treeLoading={treeLoading}
            />
          )}
        </div>
      ) : null}
    </div>
  )
}

function FileEditorTreeRowIcon({
  entry,
  isDir,
  isOpen,
}: {
  entry: ProjectFileEntry
  isDir: boolean
  isOpen: boolean
}) {
  return (
    <>
      <span className="file-editor-tree-caret" aria-hidden="true">
        {isDir ? (isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : <span style={{ width: 11, display: 'inline-block' }} />}
      </span>
      <span className="file-editor-tree-icon" aria-hidden="true">
        {isDir ? (isOpen ? <FolderOpen size={12} /> : <Folder size={12} />) : <FileEntryIcon name={entry.name} />}
      </span>
    </>
  )
}

function FileEditorContentPanel({
  content,
  gutterRef,
  handleChange,
  handleScroll,
  lineNumbers,
  loadError,
  loading,
  metaLabel,
  textareaRef,
}: {
  content: string
  gutterRef: MutableRefObject<HTMLDivElement | null>
  handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  handleScroll: () => void
  lineNumbers: number[]
  loadError: string | null
  loading: boolean
  metaLabel: string
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
}) {
  return (
    <div className="file-editor-tile-editor-area">
      {loading ? <div className="file-editor-tile-loading">Loading...</div> : null}
      {loadError ? <div className="file-editor-tile-error">{loadError}</div> : null}
      {!loading && !loadError ? (
        <div className="file-editor-tile-editor">
          <div className="file-editor-tile-gutter" ref={gutterRef} aria-hidden="true">
            {lineNumbers.map(lineNumber => (
              <span key={lineNumber} className="file-editor-tile-line-num">
                {lineNumber}
              </span>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="file-editor-tile-textarea"
            value={content}
            onChange={handleChange}
            onScroll={handleScroll}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label={`File editor: ${metaLabel}`}
          />
        </div>
      ) : null}
    </div>
  )
}
