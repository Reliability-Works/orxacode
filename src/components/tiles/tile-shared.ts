import type { CanvasTile, CanvasTheme } from '../../types/canvas'

export interface CanvasTileComponentProps {
  tile: CanvasTile
  canvasTheme: CanvasTheme
  onUpdate: (id: string, patch: Partial<CanvasTile>) => void
  onRemove: (id: string) => void
  onBringToFront: (id: string) => void
  snapToGrid?: boolean
  gridSize?: number
  allTiles?: CanvasTile[]
  canvasOffsetX?: number
  canvasOffsetY?: number
  viewportScale?: number
}

export function tilePathBasename(filePath: string, fallback = ''): string {
  if (!filePath) {
    return fallback
  }
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}
