import { parsePatchFiles } from '@pierre/diffs'
import { FileDiff, type FileDiffMetadata, Virtualizer } from '@pierre/diffs/react'
import { Columns2Icon, Rows3Icon, TextWrapIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { openInPreferredEditor } from '../editorPreferences'
import { cn } from '~/lib/utils'
import { readNativeApi } from '../nativeApi'
import { resolvePathLinkTarget } from '../terminal-links'
import { useTheme } from '../hooks/useTheme'
import { buildPatchCacheKey } from '../lib/diffRendering'
import { resolveDiffThemeName } from '../lib/diffRendering'
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from './DiffPanelShell'
import { ToggleGroup, Toggle } from './ui/toggle-group'
import { DiffPanelTurnStrip } from './DiffPanelTurnStrip'
import { useDiffPanelState } from './DiffPanel.logic'

type DiffRenderMode = 'stacked' | 'split'
type DiffThemeType = 'light' | 'dark'

const DIFF_PANEL_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--success));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, var(--success));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, var(--success));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, var(--success));

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--destructive));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, var(--destructive));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, var(--destructive));
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--background) 80%,
    var(--destructive)
  );

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`

type RenderablePatch =
  | { kind: 'files'; files: FileDiffMetadata[] }
  | { kind: 'raw'; text: string; reason: string }

function getRenderablePatch(
  patch: string | undefined,
  cacheScope = 'diff-panel'
): RenderablePatch | null {
  if (!patch) return null
  const normalizedPatch = patch.trim()
  if (normalizedPatch.length === 0) return null
  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope)
    )
    const files = parsedPatches.flatMap(p => p.files)
    if (files.length > 0) return { kind: 'files', files }
    return {
      kind: 'raw',
      text: normalizedPatch,
      reason: 'Unsupported diff format. Showing raw patch.',
    }
  } catch {
    return {
      kind: 'raw',
      text: normalizedPatch,
      reason: 'Failed to parse patch. Showing raw patch.',
    }
  }
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? ''
  return raw.startsWith('a/') || raw.startsWith('b/') ? raw.slice(2) : raw
}

function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? 'none'}:${fileDiff.name}`
}

interface DiffPanelProps {
  mode?: DiffPanelMode
}

export { DiffWorkerPoolProvider } from './DiffWorkerPoolProvider'

interface DiffFileListProps {
  renderableFiles: FileDiffMetadata[]
  selectedFilePath: string | null
  diffRenderMode: DiffRenderMode
  diffWordWrap: boolean
  resolvedTheme: string
  activeCwd: string | undefined
}

function DiffFileList({
  renderableFiles,
  selectedFilePath,
  diffRenderMode,
  diffWordWrap,
  resolvedTheme,
  activeCwd,
}: DiffFileListProps) {
  const patchViewportRef = useRef<HTMLDivElement>(null)

  const openDiffFileInEditor = useCallback(
    (filePath: string) => {
      const api = readNativeApi()
      if (!api) return
      const targetPath = activeCwd ? resolvePathLinkTarget(filePath, activeCwd) : filePath
      void openInPreferredEditor(api, targetPath).catch(error => {
        console.warn('Failed to open diff file in editor.', error)
      })
    },
    [activeCwd]
  )

  useEffect(() => {
    if (!selectedFilePath || !patchViewportRef.current) return
    const target = Array.from(
      patchViewportRef.current.querySelectorAll<HTMLElement>('[data-diff-file-path]')
    ).find(element => element.dataset.diffFilePath === selectedFilePath)
    target?.scrollIntoView({ block: 'nearest' })
  }, [selectedFilePath, renderableFiles])

  return (
    <div
      ref={patchViewportRef}
      className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <Virtualizer
        className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
        config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
      >
        {renderableFiles.map(fileDiff => {
          const filePath = resolveFileDiffPath(fileDiff)
          const fileKey = buildFileDiffRenderKey(fileDiff)
          return (
            <div
              key={`${fileKey}:${resolvedTheme}`}
              data-diff-file-path={filePath}
              className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
              onClickCapture={event => {
                const composedPath = (event.nativeEvent as MouseEvent).composedPath?.() ?? []
                const clickedHeader = composedPath.some(
                  node => node instanceof Element && node.hasAttribute('data-title')
                )
                if (!clickedHeader) return
                openDiffFileInEditor(filePath)
              }}
            >
              <FileDiff
                fileDiff={fileDiff}
                options={{
                  diffStyle: diffRenderMode === 'split' ? 'split' : 'unified',
                  lineDiffType: 'none',
                  overflow: diffWordWrap ? 'wrap' : 'scroll',
                  theme: resolveDiffThemeName(resolvedTheme === 'dark' ? 'dark' : 'light'),
                  themeType: (resolvedTheme === 'dark' ? 'dark' : 'light') as DiffThemeType,
                  unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                }}
              />
            </div>
          )
        })}
      </Virtualizer>
    </div>
  )
}

interface DiffContentProps {
  renderablePatch: RenderablePatch | null
  renderableFiles: FileDiffMetadata[]
  selectedFilePath: string | null
  checkpointDiffError: string | null
  isLoadingCheckpointDiff: boolean
  hasNoNetChanges: boolean
  diffRenderMode: DiffRenderMode
  diffWordWrap: boolean
  resolvedTheme: string
  activeCwd: string | undefined
}

function DiffContent({
  renderablePatch,
  renderableFiles,
  selectedFilePath,
  checkpointDiffError,
  isLoadingCheckpointDiff,
  hasNoNetChanges,
  diffRenderMode,
  diffWordWrap,
  resolvedTheme,
  activeCwd,
}: DiffContentProps) {
  if (!renderablePatch) {
    if (checkpointDiffError) {
      return (
        <div className="px-3">
          <p className="mb-2 text-[11px] text-red-500/80">{checkpointDiffError}</p>
          {isLoadingCheckpointDiff ? (
            <DiffPanelLoadingState label="Loading checkpoint diff..." />
          ) : null}
        </div>
      )
    }
    if (isLoadingCheckpointDiff) return <DiffPanelLoadingState label="Loading checkpoint diff..." />
    return (
      <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
        <p>
          {hasNoNetChanges
            ? 'No net changes in this selection.'
            : 'No patch available for this selection.'}
        </p>
      </div>
    )
  }
  if (renderablePatch.kind === 'files') {
    return (
      <DiffFileList
        renderableFiles={renderableFiles}
        selectedFilePath={selectedFilePath}
        diffRenderMode={diffRenderMode}
        diffWordWrap={diffWordWrap}
        resolvedTheme={resolvedTheme}
        activeCwd={activeCwd}
      />
    )
  }
  return (
    <div className="h-full overflow-auto p-2">
      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
        <pre
          className={cn(
            'max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90',
            diffWordWrap ? 'overflow-auto whitespace-pre-wrap wrap-break-word' : 'overflow-auto'
          )}
        >
          {renderablePatch.text}
        </pre>
      </div>
    </div>
  )
}

interface DiffHeaderRowProps {
  orderedTurnDiffSummaries: ReturnType<typeof useDiffPanelState>['orderedTurnDiffSummaries']
  inferredCheckpointTurnCountByTurnId: ReturnType<
    typeof useDiffPanelState
  >['inferredCheckpointTurnCountByTurnId']
  selectedTurnId: ReturnType<typeof useDiffPanelState>['selectedTurnId']
  selectedTurn: ReturnType<typeof useDiffPanelState>['selectedTurn']
  timestampFormat: ReturnType<typeof useDiffPanelState>['settings']['timestampFormat']
  selectTurn: ReturnType<typeof useDiffPanelState>['selectTurn']
  selectWholeConversation: ReturnType<typeof useDiffPanelState>['selectWholeConversation']
  diffRenderMode: DiffRenderMode
  diffWordWrap: boolean
  setDiffRenderMode: (mode: DiffRenderMode) => void
  setDiffWordWrap: (wrap: boolean) => void
}

function DiffHeaderRow({
  orderedTurnDiffSummaries,
  inferredCheckpointTurnCountByTurnId,
  selectedTurnId,
  selectedTurn,
  timestampFormat,
  selectTurn,
  selectWholeConversation,
  diffRenderMode,
  diffWordWrap,
  setDiffRenderMode,
  setDiffWordWrap,
}: DiffHeaderRowProps) {
  return (
    <>
      <DiffPanelTurnStrip
        orderedTurnDiffSummaries={orderedTurnDiffSummaries}
        inferredCheckpointTurnCountByTurnId={inferredCheckpointTurnCountByTurnId}
        selectedTurnId={selectedTurnId}
        selectedTurn={selectedTurn}
        timestampFormat={timestampFormat}
        onSelectWholeConversation={selectWholeConversation}
        onSelectTurn={selectTurn}
      />
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <ToggleGroup
          className="shrink-0"
          variant="outline"
          size="xs"
          value={[diffRenderMode]}
          onValueChange={value => {
            const next = value[0]
            if (next === 'stacked' || next === 'split') setDiffRenderMode(next)
          }}
        >
          <Toggle aria-label="Stacked diff view" value="stacked">
            <Rows3Icon className="size-3" />
          </Toggle>
          <Toggle aria-label="Split diff view" value="split">
            <Columns2Icon className="size-3" />
          </Toggle>
        </ToggleGroup>
        <Toggle
          aria-label={diffWordWrap ? 'Disable diff line wrapping' : 'Enable diff line wrapping'}
          title={diffWordWrap ? 'Disable line wrapping' : 'Enable line wrapping'}
          variant="outline"
          size="xs"
          pressed={diffWordWrap}
          onPressedChange={pressed => setDiffWordWrap(Boolean(pressed))}
        >
          <TextWrapIcon className="size-3" />
        </Toggle>
      </div>
    </>
  )
}

function useDiffPanelView(input: {
  diffOpen: boolean
  initialDiffWordWrap: boolean
  activePatch: string | undefined
  resolvedTheme: string
}) {
  const { diffOpen, initialDiffWordWrap, activePatch, resolvedTheme } = input
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>('stacked')
  const [diffWordWrap, setDiffWordWrap] = useState(initialDiffWordWrap)
  const previousDiffOpenRef = useRef(false)
  useEffect(() => {
    if (diffOpen && !previousDiffOpenRef.current) setDiffWordWrap(initialDiffWordWrap)
    previousDiffOpenRef.current = diffOpen
  }, [diffOpen, initialDiffWordWrap])
  const hasResolvedPatch = typeof activePatch === 'string'
  const hasNoNetChanges = hasResolvedPatch && activePatch.trim().length === 0
  const renderablePatch = useMemo(
    () => getRenderablePatch(activePatch, `diff-panel:${resolvedTheme}`),
    [resolvedTheme, activePatch]
  )
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== 'files') return []
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    )
  }, [renderablePatch])
  return {
    diffRenderMode,
    setDiffRenderMode,
    diffWordWrap,
    setDiffWordWrap,
    hasNoNetChanges,
    renderablePatch,
    renderableFiles,
  }
}

interface DiffPanelBodyProps extends DiffContentProps {
  activeThread: ReturnType<typeof useDiffPanelState>['activeThread']
  isGitRepo: boolean
  orderedTurnDiffSummaries: ReturnType<typeof useDiffPanelState>['orderedTurnDiffSummaries']
}

function DiffPanelBody(props: DiffPanelBodyProps) {
  const { activeThread, isGitRepo, orderedTurnDiffSummaries, ...diffContentProps } = props
  if (!activeThread) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
        Select a thread to inspect turn diffs.
      </div>
    )
  }
  if (!isGitRepo) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
        Turn diffs are unavailable because this project is not a git repository.
      </div>
    )
  }
  if (orderedTurnDiffSummaries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
        No completed turns yet.
      </div>
    )
  }
  return <DiffContent {...diffContentProps} />
}

export default function DiffPanel({ mode = 'inline' }: DiffPanelProps) {
  const { resolvedTheme } = useTheme()
  const panelState = useDiffPanelState()
  const {
    settings,
    diffOpen,
    activeThread,
    activeCwd,
    isGitRepo,
    orderedTurnDiffSummaries,
    inferredCheckpointTurnCountByTurnId,
    selectedTurnId,
    selectedFilePath,
    selectedTurn,
    activePatch,
    isLoadingCheckpointDiff,
    checkpointDiffError,
    selectTurn,
    selectWholeConversation,
  } = panelState

  const {
    diffRenderMode,
    setDiffRenderMode,
    diffWordWrap,
    setDiffWordWrap,
    hasNoNetChanges,
    renderablePatch,
    renderableFiles,
  } = useDiffPanelView({
    diffOpen,
    initialDiffWordWrap: settings.diffWordWrap,
    activePatch,
    resolvedTheme,
  })

  return (
    <DiffPanelShell
      mode={mode}
      header={
        <DiffHeaderRow
          orderedTurnDiffSummaries={orderedTurnDiffSummaries}
          inferredCheckpointTurnCountByTurnId={inferredCheckpointTurnCountByTurnId}
          selectedTurnId={selectedTurnId}
          selectedTurn={selectedTurn}
          timestampFormat={settings.timestampFormat}
          selectTurn={selectTurn}
          selectWholeConversation={selectWholeConversation}
          diffRenderMode={diffRenderMode}
          diffWordWrap={diffWordWrap}
          setDiffRenderMode={setDiffRenderMode}
          setDiffWordWrap={setDiffWordWrap}
        />
      }
    >
      <DiffPanelBody
        activeThread={activeThread}
        isGitRepo={isGitRepo}
        orderedTurnDiffSummaries={orderedTurnDiffSummaries}
        renderablePatch={renderablePatch}
        renderableFiles={renderableFiles}
        selectedFilePath={selectedFilePath}
        checkpointDiffError={checkpointDiffError}
        isLoadingCheckpointDiff={isLoadingCheckpointDiff}
        hasNoNetChanges={hasNoNetChanges}
        diffRenderMode={diffRenderMode}
        diffWordWrap={diffWordWrap}
        resolvedTheme={resolvedTheme}
        activeCwd={activeCwd}
      />
    </DiffPanelShell>
  )
}
