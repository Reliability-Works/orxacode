import { useEffect, useRef, useState } from 'react'
import { Terminal as TerminalIcon } from 'lucide-react'
import { SerializeAddon } from 'xterm-addon-serialize'
import 'xterm/css/xterm.css'
import { CanvasTileComponent } from '../CanvasTile'
import type { CanvasTileComponentProps } from './tile-shared'
import { type ManagedTerminal } from '../../lib/xterm-terminal'
import {
  createScheduleSnapshotPersist,
  createTerminalCleanup,
  getCanvasTerminalMeta,
  getIconColor,
  getTileLabel,
  handleTerminalError,
  initTerminalInstance,
  setupTerminalConnection,
  type TerminalSetupDeps,
  useTerminalRemoveHandler,
} from './TerminalTileHelpers'


type TerminalTileProps = CanvasTileComponentProps

type TerminalLoadState = 'connecting' | 'ready' | 'error'


function useTerminalTileState(serializedOutput: string) {
  const [loadState, setLoadState] = useState<TerminalLoadState>('connecting')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<ManagedTerminal | null>(null)
  const serializeAddonRef = useRef<SerializeAddon | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const cleanupRef = useRef<Array<() => void>>([])
  const startupBufferRef = useRef<string[]>([])
  const startupReadyRef = useRef(true)
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSerializedOutputRef = useRef(serializedOutput)

  return {
    loadState,
    setLoadState,
    errorMessage,
    setErrorMessage,
    containerRef,
    terminalRef,
    serializeAddonRef,
    ptyIdRef,
    cleanupRef,
    startupBufferRef,
    startupReadyRef,
    snapshotTimerRef,
    lastSerializedOutputRef,
  }
}

type UseTerminalInitDeps = {
  directory: string
  serializedOutput: string
  startupCommand: string
  startupFilter: string | null
  tile: TerminalTileProps['tile']
  onUpdate: TerminalTileProps['onUpdate']
}


function useTerminalInit(
  deps: UseTerminalInitDeps,
  state: ReturnType<typeof useTerminalTileState>
) {
  const {
    directory,
    serializedOutput,
    startupCommand,
    startupFilter,
    tile,
    onUpdate,
  } = deps
  const {
    setLoadState,
    setErrorMessage,
    containerRef,
    terminalRef,
    serializeAddonRef,
    ptyIdRef,
    cleanupRef,
    startupBufferRef,
    startupReadyRef,
    snapshotTimerRef,
    lastSerializedOutputRef,
  } = state

  const scheduleSnapshotPersist = createScheduleSnapshotPersist(
    snapshotTimerRef,
    serializeAddonRef,
    lastSerializedOutputRef,
    tile,
    onUpdate,
    directory,
    ptyIdRef
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    if (!window.orxa?.terminal) {
      setLoadState('error')
      setErrorMessage('Terminal unavailable in this environment.')
      return
    }

    const cancelledRef = { current: false }
    startupBufferRef.current = []
    startupReadyRef.current = startupFilter !== 'claude'

    const setupDeps: TerminalSetupDeps = {
      container,
      directory,
      serializedOutput,
      startupCommand,
      startupFilter,
      setLoadState,
      setErrorMessage,
      terminalRef,
      serializeAddonRef,
      ptyIdRef,
      cleanupRef,
      startupBufferRef,
      startupReadyRef,
      scheduleSnapshotPersist,
      tile,
      onUpdate,
    }

    const { managed, terminal, cleanups } = initTerminalInstance(
      container,
      serializedOutput,
      terminalRef,
      serializeAddonRef,
      cleanupRef,
      directory,
      ptyIdRef
    )

    const resizeTerminal = () => {
      managed.refit()
      if (ptyIdRef.current) {
        void window.orxa.terminal.resize(directory, ptyIdRef.current, terminal.cols, terminal.rows)
      }
    }

    void (async () => {
      try {
        await setupTerminalConnection(setupDeps, cancelledRef)
      } catch (error) {
        handleTerminalError(error, cancelledRef.current, terminal, setLoadState, setErrorMessage)
      }
    })()

    const resizeObs = new ResizeObserver(() => resizeTerminal())
    resizeObs.observe(container)
    cleanups.push(() => resizeObs.disconnect())

    return createTerminalCleanup(cancelledRef, cleanupRef, snapshotTimerRef, managed, terminalRef, serializeAddonRef, ptyIdRef)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { scheduleSnapshotPersist }
}


export function TerminalTile({
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
}: TerminalTileProps) {
  const { directory, cwd, serializedOutput, startupCommand, startupFilter } =
    getCanvasTerminalMeta(tile)

  const state = useTerminalTileState(serializedOutput)
  const { loadState, errorMessage, containerRef } = state

  useTerminalInit(
    { directory, serializedOutput, startupCommand, startupFilter, tile, onUpdate },
    state
  )

  const metaLabel = cwd || directory || 'terminal'
  const tileLabel = getTileLabel(tile.type)
  const iconColor = getIconColor(tile.type)
  const handleRemove = useTerminalRemoveHandler(tile, directory, state.ptyIdRef, onRemove)

  return (
    <CanvasTileComponent
      tile={tile}
      canvasTheme={canvasTheme}
      onUpdate={onUpdate}
      onRemove={handleRemove}
      onBringToFront={onBringToFront}
      icon={<TerminalIcon size={12} />}
      label={tileLabel}
      iconColor={iconColor}
      metadata={metaLabel}
      snapToGrid={snapToGrid}
      gridSize={gridSize}
      allTiles={allTiles}
      canvasOffsetX={canvasOffsetX}
      canvasOffsetY={canvasOffsetY}
      viewportScale={viewportScale}
    >
      <div className="terminal-tile-shell">
        <div className="terminal-tile-body" ref={containerRef} />
        {loadState !== 'ready' ? (
          <div className={`terminal-tile-status terminal-tile-status-${loadState}`}>
            {loadState === 'connecting'
              ? 'Connecting terminal...'
              : (errorMessage ?? 'Terminal failed to load.')}
          </div>
        ) : null}
      </div>
    </CanvasTileComponent>
  )
}
