import { FitAddon } from '@xterm/addon-fit'
import { Plus, SquareSplitHorizontal, Trash2 } from 'lucide-react'
import { type ThreadId } from '@orxa-code/contracts'
import { Terminal } from '@xterm/xterm'
import { useCallback, useEffect, useRef } from 'react'
import { TerminalDrawerButton } from './ThreadTerminalDrawer.button'
import { type TerminalContextSelection } from '~/lib/terminalContext'
import { MAX_TERMINALS_PER_GROUP, type ThreadTerminalGroup } from '../types'
import { readNativeApi } from '~/nativeApi'
import {
  setupTerminalViewport,
  type TerminalViewportSetupRefs,
} from './ThreadTerminalDrawer.viewport-setup'
import { useTerminalDrawerResize } from './ThreadTerminalDrawer.resize'
import { useResolvedTerminalLayout } from './ThreadTerminalDrawer.groups'
import { TerminalSidebar } from './ThreadTerminalDrawer.sidebar'

interface TerminalViewportProps {
  threadId: ThreadId
  terminalId: string
  terminalLabel: string
  cwd: string
  runtimeEnv?: Record<string, string>
  onSessionExited: () => void
  onAddTerminalContext: (selection: TerminalContextSelection) => void
  focusRequestId: number
  autoFocus: boolean
  resizeEpoch: number
  drawerHeight: number
}

function useTerminalViewportRefs() {
  return {
    containerRef: useRef<HTMLDivElement>(null),
    terminalRef: useRef<Terminal | null>(null),
    fitAddonRef: useRef<FitAddon | null>(null),
    hasHandledExitRef: useRef(false),
    selectionPointerRef: useRef<{ x: number; y: number } | null>(null),
    selectionGestureActiveRef: useRef(false),
    selectionActionRequestIdRef: useRef(0),
    selectionActionOpenRef: useRef(false),
    selectionActionTimerRef: useRef<number | null>(null),
  }
}

function useTerminalAutoFocusEffect(
  terminalRef: React.MutableRefObject<Terminal | null>,
  autoFocus: boolean,
  focusRequestId: number
) {
  useEffect(() => {
    if (!autoFocus) return
    const terminal = terminalRef.current
    if (!terminal) return
    const frame = window.requestAnimationFrame(() => {
      terminal.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [autoFocus, focusRequestId, terminalRef])
}

function useTerminalResizeEffect(
  terminalRef: React.MutableRefObject<Terminal | null>,
  fitAddonRef: React.MutableRefObject<FitAddon | null>,
  threadId: ThreadId,
  terminalId: string,
  drawerHeight: number,
  resizeEpoch: number
) {
  useEffect(() => {
    const api = readNativeApi()
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!api || !terminal || !fitAddon) return
    const wasAtBottom = terminal.buffer.active.viewportY >= terminal.buffer.active.baseY
    const frame = window.requestAnimationFrame(() => {
      fitAddon.fit()
      if (wasAtBottom) {
        terminal.scrollToBottom()
      }
      void api.terminal
        .resize({ threadId, terminalId, cols: terminal.cols, rows: terminal.rows })
        .catch(() => undefined)
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [drawerHeight, fitAddonRef, resizeEpoch, terminalId, terminalRef, threadId])
}

function TerminalViewport({
  threadId,
  terminalId,
  terminalLabel,
  cwd,
  runtimeEnv,
  onSessionExited,
  onAddTerminalContext,
  focusRequestId,
  autoFocus,
  resizeEpoch,
  drawerHeight,
}: TerminalViewportProps) {
  const refs = useTerminalViewportRefs()
  const {
    containerRef,
    terminalRef,
    fitAddonRef,
    hasHandledExitRef,
    selectionPointerRef,
    selectionGestureActiveRef,
    selectionActionRequestIdRef,
    selectionActionOpenRef,
    selectionActionTimerRef,
  } = refs
  const onSessionExitedRef = useRef(onSessionExited)
  const onAddTerminalContextRef = useRef(onAddTerminalContext)
  const terminalLabelRef = useRef(terminalLabel)
  useEffect(() => {
    onSessionExitedRef.current = onSessionExited
  }, [onSessionExited])
  useEffect(() => {
    onAddTerminalContextRef.current = onAddTerminalContext
  }, [onAddTerminalContext])
  useEffect(() => {
    terminalLabelRef.current = terminalLabel
  }, [terminalLabel])
  useEffect(() => {
    const setupRefs: TerminalViewportSetupRefs = {
      containerRef: containerRef as React.MutableRefObject<HTMLDivElement | null>,
      terminalRef,
      fitAddonRef,
      onSessionExitedRef,
      onAddTerminalContextRef,
      terminalLabelRef,
      hasHandledExitRef,
      selectionPointerRef,
      selectionGestureActiveRef,
      selectionActionRequestIdRef,
      selectionActionOpenRef,
      selectionActionTimerRef,
    }
    return setupTerminalViewport(setupRefs, { threadId, terminalId, cwd, runtimeEnv, autoFocus })
    // autoFocus is intentionally omitted from deps;
    // it is only read at mount time and must not trigger terminal teardown/recreation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, runtimeEnv, terminalId, threadId])
  useTerminalAutoFocusEffect(terminalRef, autoFocus, focusRequestId)
  useTerminalResizeEffect(terminalRef, fitAddonRef, threadId, terminalId, drawerHeight, resizeEpoch)
  return <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-[4px]" />
}

interface ThreadTerminalDrawerProps {
  threadId: ThreadId
  cwd: string
  runtimeEnv?: Record<string, string>
  height: number
  terminalIds: string[]
  activeTerminalId: string
  terminalGroups: ThreadTerminalGroup[]
  activeTerminalGroupId: string
  focusRequestId: number
  onSplitTerminal: () => void
  onNewTerminal: () => void
  splitShortcutLabel?: string | undefined
  newShortcutLabel?: string | undefined
  closeShortcutLabel?: string | undefined
  onActiveTerminalChange: (terminalId: string) => void
  onCloseTerminal: (terminalId: string) => void
  onHeightChange: (height: number) => void
  onAddTerminalContext: (selection: TerminalContextSelection) => void
}

const TerminalActionButton = TerminalDrawerButton

interface TerminalGridContentProps {
  threadId: ThreadId
  cwd: string
  runtimeEnv?: Record<string, string>
  visibleTerminalIds: string[]
  resolvedActiveTerminalId: string
  terminalLabelById: Map<string, string>
  isSplitView: boolean
  focusRequestId: number
  resizeEpoch: number
  drawerHeight: number
  onActiveTerminalChange: (id: string) => void
  onCloseTerminal: (id: string) => void
  onAddTerminalContext: (selection: TerminalContextSelection) => void
}

function TerminalGridContent({
  threadId,
  cwd,
  runtimeEnv,
  visibleTerminalIds,
  resolvedActiveTerminalId,
  terminalLabelById,
  isSplitView,
  focusRequestId,
  resizeEpoch,
  drawerHeight,
  onActiveTerminalChange,
  onCloseTerminal,
  onAddTerminalContext,
}: TerminalGridContentProps) {
  if (isSplitView) {
    return (
      <div
        className="grid h-full w-full min-w-0 gap-0 overflow-hidden"
        style={{ gridTemplateColumns: `repeat(${visibleTerminalIds.length}, minmax(0, 1fr))` }}
      >
        {visibleTerminalIds.map(terminalId => (
          <div
            key={terminalId}
            className={`min-h-0 min-w-0 border-l first:border-l-0 ${terminalId === resolvedActiveTerminalId ? 'border-border' : 'border-border/70'}`}
            onMouseDown={() => {
              if (terminalId !== resolvedActiveTerminalId) onActiveTerminalChange(terminalId)
            }}
          >
            <div className="h-full p-1">
              <TerminalViewport
                threadId={threadId}
                terminalId={terminalId}
                terminalLabel={terminalLabelById.get(terminalId) ?? 'Terminal'}
                cwd={cwd}
                {...(runtimeEnv ? { runtimeEnv } : {})}
                onSessionExited={() => onCloseTerminal(terminalId)}
                onAddTerminalContext={onAddTerminalContext}
                focusRequestId={focusRequestId}
                autoFocus={terminalId === resolvedActiveTerminalId}
                resizeEpoch={resizeEpoch}
                drawerHeight={drawerHeight}
              />
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="h-full p-1">
      <TerminalViewport
        key={resolvedActiveTerminalId}
        threadId={threadId}
        terminalId={resolvedActiveTerminalId}
        terminalLabel={terminalLabelById.get(resolvedActiveTerminalId) ?? 'Terminal'}
        cwd={cwd}
        {...(runtimeEnv ? { runtimeEnv } : {})}
        onSessionExited={() => onCloseTerminal(resolvedActiveTerminalId)}
        onAddTerminalContext={onAddTerminalContext}
        focusRequestId={focusRequestId}
        autoFocus
        resizeEpoch={resizeEpoch}
        drawerHeight={drawerHeight}
      />
    </div>
  )
}

function buildActionLabels(
  hasReachedSplitLimit: boolean,
  splitShortcutLabel: string | undefined,
  newShortcutLabel: string | undefined,
  closeShortcutLabel: string | undefined
) {
  const splitLabel = hasReachedSplitLimit
    ? `Split Terminal (max ${MAX_TERMINALS_PER_GROUP} per group)`
    : splitShortcutLabel
      ? `Split Terminal (${splitShortcutLabel})`
      : 'Split Terminal'
  const newLabel = newShortcutLabel ? `New Terminal (${newShortcutLabel})` : 'New Terminal'
  const closeLabel = closeShortcutLabel
    ? `Close Terminal (${closeShortcutLabel})`
    : 'Close Terminal'
  return { splitLabel, newLabel, closeLabel }
}

interface TerminalFloatingActionsProps {
  hasReachedSplitLimit: boolean
  splitLabel: string
  newLabel: string
  closeLabel: string
  onSplitTerminalAction: () => void
  onNewTerminalAction: () => void
  onCloseActive: () => void
}

function TerminalFloatingActions({
  hasReachedSplitLimit,
  splitLabel,
  newLabel,
  closeLabel,
  onSplitTerminalAction,
  onNewTerminalAction,
  onCloseActive,
}: TerminalFloatingActionsProps) {
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-20">
      <div className="pointer-events-auto inline-flex items-center overflow-hidden rounded-md border border-border/80 bg-background/70">
        <TerminalActionButton
          className={`p-1 text-foreground/90 transition-colors ${hasReachedSplitLimit ? 'cursor-not-allowed opacity-45 hover:bg-transparent' : 'hover:bg-accent'}`}
          onClick={onSplitTerminalAction}
          label={splitLabel}
        >
          <SquareSplitHorizontal className="size-3.25" />
        </TerminalActionButton>
        <div className="h-4 w-px bg-border/80" />
        <TerminalActionButton
          className="p-1 text-foreground/90 transition-colors hover:bg-accent"
          onClick={onNewTerminalAction}
          label={newLabel}
        >
          <Plus className="size-3.25" />
        </TerminalActionButton>
        <div className="h-4 w-px bg-border/80" />
        <TerminalActionButton
          className="p-1 text-foreground/90 transition-colors hover:bg-accent"
          onClick={onCloseActive}
          label={closeLabel}
        >
          <Trash2 className="size-3.25" />
        </TerminalActionButton>
      </div>
    </div>
  )
}

interface TerminalDrawerBodyProps extends ThreadTerminalDrawerProps {
  drawerHeight: number
  resizeEpoch: number
  handleResizePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  handleResizePointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  handleResizePointerEnd: (event: React.PointerEvent<HTMLDivElement>) => void
}

function useDrawerActionCallbacks(
  hasReachedSplitLimit: boolean,
  onSplitTerminal: () => void,
  onNewTerminal: () => void
) {
  const onSplitTerminalAction = useCallback(() => {
    if (hasReachedSplitLimit) return
    onSplitTerminal()
  }, [hasReachedSplitLimit, onSplitTerminal])
  const onNewTerminalAction = useCallback(() => {
    onNewTerminal()
  }, [onNewTerminal])
  return { onSplitTerminalAction, onNewTerminalAction }
}

interface TerminalDrawerInnerProps {
  props: TerminalDrawerBodyProps
  layout: ReturnType<typeof useResolvedTerminalLayout>
  splitLabel: string
  newLabel: string
  closeLabel: string
  onSplitTerminalAction: () => void
  onNewTerminalAction: () => void
}

function TerminalDrawerInner({
  props,
  layout,
  splitLabel,
  newLabel,
  onSplitTerminalAction,
  onNewTerminalAction,
}: TerminalDrawerInnerProps) {
  return (
    <div className="min-h-0 w-full flex-1">
      <div className={`flex h-full min-h-0 ${layout.hasTerminalSidebar ? 'gap-1.5' : ''}`}>
        <div className="min-w-0 flex-1">
          <TerminalGridContent
            threadId={props.threadId}
            cwd={props.cwd}
            {...(props.runtimeEnv ? { runtimeEnv: props.runtimeEnv } : {})}
            visibleTerminalIds={layout.visibleTerminalIds}
            resolvedActiveTerminalId={layout.resolvedActiveTerminalId}
            terminalLabelById={layout.terminalLabelById}
            isSplitView={layout.isSplitView}
            focusRequestId={props.focusRequestId}
            resizeEpoch={props.resizeEpoch}
            drawerHeight={props.drawerHeight}
            onActiveTerminalChange={props.onActiveTerminalChange}
            onCloseTerminal={props.onCloseTerminal}
            onAddTerminalContext={props.onAddTerminalContext}
          />
        </div>
        {layout.hasTerminalSidebar && (
          <TerminalSidebar
            resolvedTerminalGroups={layout.resolvedTerminalGroups}
            resolvedActiveTerminalId={layout.resolvedActiveTerminalId}
            terminalLabelById={layout.terminalLabelById}
            normalizedTerminalIds={layout.normalizedTerminalIds}
            showGroupHeaders={layout.showGroupHeaders}
            hasReachedSplitLimit={layout.hasReachedSplitLimit}
            splitTerminalActionLabel={splitLabel}
            newTerminalActionLabel={newLabel}
            closeShortcutLabel={props.closeShortcutLabel}
            onSplitTerminalAction={onSplitTerminalAction}
            onNewTerminalAction={onNewTerminalAction}
            onActiveTerminalChange={props.onActiveTerminalChange}
            onCloseTerminal={props.onCloseTerminal}
          />
        )}
      </div>
    </div>
  )
}

function TerminalDrawerBody(props: TerminalDrawerBodyProps) {
  const layout = useResolvedTerminalLayout(
    props.terminalIds,
    props.activeTerminalId,
    props.terminalGroups,
    props.activeTerminalGroupId
  )
  const { splitLabel, newLabel, closeLabel } = buildActionLabels(
    layout.hasReachedSplitLimit,
    props.splitShortcutLabel,
    props.newShortcutLabel,
    props.closeShortcutLabel
  )
  const { onSplitTerminalAction, onNewTerminalAction } = useDrawerActionCallbacks(
    layout.hasReachedSplitLimit,
    props.onSplitTerminal,
    props.onNewTerminal
  )
  return (
    <aside
      className="thread-terminal-drawer relative flex min-w-0 shrink-0 flex-col overflow-hidden border-t border-border/80 bg-background"
      style={{ height: `${props.drawerHeight}px` }}
    >
      <div
        className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize"
        onPointerDown={props.handleResizePointerDown}
        onPointerMove={props.handleResizePointerMove}
        onPointerUp={props.handleResizePointerEnd}
        onPointerCancel={props.handleResizePointerEnd}
      />
      {!layout.hasTerminalSidebar && (
        <TerminalFloatingActions
          hasReachedSplitLimit={layout.hasReachedSplitLimit}
          splitLabel={splitLabel}
          newLabel={newLabel}
          closeLabel={closeLabel}
          onSplitTerminalAction={onSplitTerminalAction}
          onNewTerminalAction={onNewTerminalAction}
          onCloseActive={() => props.onCloseTerminal(layout.resolvedActiveTerminalId)}
        />
      )}
      <TerminalDrawerInner
        props={props}
        layout={layout}
        splitLabel={splitLabel}
        newLabel={newLabel}
        closeLabel={closeLabel}
        onSplitTerminalAction={onSplitTerminalAction}
        onNewTerminalAction={onNewTerminalAction}
      />
    </aside>
  )
}

export default function ThreadTerminalDrawer(props: ThreadTerminalDrawerProps) {
  const {
    drawerHeight,
    resizeEpoch,
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerEnd,
  } = useTerminalDrawerResize(props.height, props.threadId, props.onHeightChange)
  return (
    <TerminalDrawerBody
      {...props}
      drawerHeight={drawerHeight}
      resizeEpoch={resizeEpoch}
      handleResizePointerDown={handleResizePointerDown}
      handleResizePointerMove={handleResizePointerMove}
      handleResizePointerEnd={handleResizePointerEnd}
    />
  )
}
