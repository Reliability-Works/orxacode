export type SessionType = 'standalone' | 'canvas' | 'codex' | 'claude' | 'claude-chat'

export const CANVAS_WORLD_SIZE = 100_000
export const CANVAS_WORLD_ORIGIN = 50_000
export const DEFAULT_CANVAS_ZOOM = 1
export const MIN_CANVAS_ZOOM = 0.01
export const MAX_CANVAS_ZOOM = 8
export const DEFAULT_CANVAS_SCROLL_LEFT = CANVAS_WORLD_ORIGIN - 320
export const DEFAULT_CANVAS_SCROLL_TOP = CANVAS_WORLD_ORIGIN - 220

export interface CanvasTile {
  id: string
  type:
    | 'terminal'
    | 'claude_code'
    | 'codex_cli'
    | 'opencode_cli'
    | 'browser'
    | 'file_editor'
    | 'dev_server'
    | 'markdown_preview'
    | 'image_viewer'
    | 'api_tester'
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  minimized: boolean
  maximized: boolean
  meta: Record<string, unknown>
}

export interface CanvasTheme {
  preset: string | null
  background: string
  backgroundImage?: string
  tileBorder: string
  accent: string
}

export interface CanvasViewport {
  zoom: number
  scrollLeft: number
  scrollTop: number
}

export interface CanvasSessionState {
  tiles: CanvasTile[]
  theme: CanvasTheme
  snapToGrid: boolean
  gridSize: number
  viewport: CanvasViewport
}
