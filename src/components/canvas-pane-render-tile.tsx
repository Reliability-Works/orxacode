import type { ReactElement } from 'react'
import type { McpDevToolsServerState } from '@shared/ipc'
import type { CanvasTile, CanvasTheme } from '../types/canvas'
import { CANVAS_WORLD_ORIGIN } from '../types/canvas'
import { CanvasTileComponent } from './CanvasTile'
import { TerminalTile } from './tiles/TerminalTile'
import { BrowserTile } from './tiles/BrowserTile'
import { FileEditorTile } from './tiles/FileEditorTile'
import { DevServerTile } from './tiles/DevServerTile'
import { MarkdownTile } from './tiles/MarkdownTile'
import { ImageTile } from './tiles/ImageTile'
import { ApiTesterTile } from './tiles/ApiTesterTile'

type RenderCanvasPaneTileArgs = {
  tile: CanvasTile
  theme: CanvasTheme
  onUpdate: (id: string, patch: Partial<CanvasTile>) => void
  onRemove: (id: string) => void
  onBringToFront: (id: string) => void
  snapToGrid: boolean
  gridSize: number
  allTiles: CanvasTile[]
  viewportZoom: number
  accent: string
  mcpDevToolsState?: McpDevToolsServerState
  inViewportOverlay?: boolean
}

export function renderCanvasPaneTile({
  tile,
  theme,
  onUpdate,
  onRemove,
  onBringToFront,
  snapToGrid,
  gridSize,
  allTiles,
  viewportZoom,
  accent,
  mcpDevToolsState,
  inViewportOverlay = false,
}: RenderCanvasPaneTileArgs): ReactElement {
  const commonProps = {
    tile,
    canvasTheme: theme,
    onUpdate,
    onRemove,
    onBringToFront,
    snapToGrid,
    gridSize,
    allTiles,
    canvasOffsetX: inViewportOverlay ? 0 : CANVAS_WORLD_ORIGIN,
    canvasOffsetY: inViewportOverlay ? 0 : CANVAS_WORLD_ORIGIN,
    viewportScale: inViewportOverlay ? 1 : viewportZoom,
  }

  if (tile.type === 'terminal' || tile.type === 'claude_code' || tile.type === 'codex_cli' || tile.type === 'opencode_cli') {
    return <TerminalTile key={tile.id} {...commonProps} />
  }
  if (tile.type === 'browser') {
    return <BrowserTile key={tile.id} {...commonProps} mcpDevToolsState={mcpDevToolsState} />
  }
  if (tile.type === 'file_editor') return <FileEditorTile key={tile.id} {...commonProps} />
  if (tile.type === 'dev_server') return <DevServerTile key={tile.id} {...commonProps} />
  if (tile.type === 'markdown_preview') return <MarkdownTile key={tile.id} {...commonProps} />
  if (tile.type === 'image_viewer') return <ImageTile key={tile.id} {...commonProps} />
  if (tile.type === 'api_tester') return <ApiTesterTile key={tile.id} {...commonProps} />

  return (
    <CanvasTileComponent key={tile.id} {...commonProps} icon={null} label={tile.type} iconColor={accent}>
      <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>Tile content ({tile.type})</div>
    </CanvasTileComponent>
  )
}
