import { useCallback } from 'react'
import { usePersistedState } from './usePersistedState'
import type { CanvasTile, CanvasTheme, CanvasSessionState, CanvasViewport } from '../types/canvas'
import {
  DEFAULT_CANVAS_SCROLL_LEFT,
  DEFAULT_CANVAS_SCROLL_TOP,
  DEFAULT_CANVAS_ZOOM,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
} from '../types/canvas'

const DEFAULT_THEME: CanvasTheme = {
  preset: 'glass',
  background:
    'radial-gradient(700px 700px at 15% 20%, rgba(108,123,255,0.13) 0%, transparent 100%), radial-gradient(450px 450px at 5% 80%, rgba(168,85,247,0.08) 0%, transparent 100%), radial-gradient(600px 600px at 75% 70%, rgba(124,58,237,0.10) 0%, transparent 100%), radial-gradient(500px 500px at 85% 15%, rgba(14,165,233,0.09) 0%, transparent 100%), #0A0A14',
  tileBorder: 'rgba(255,255,255,0.08)',
  accent: '#6C7BFF',
}

const DEFAULT_VIEWPORT: CanvasViewport = {
  zoom: DEFAULT_CANVAS_ZOOM,
  scrollLeft: DEFAULT_CANVAS_SCROLL_LEFT,
  scrollTop: DEFAULT_CANVAS_SCROLL_TOP,
}

const DEFAULT_STATE: CanvasSessionState = {
  tiles: [],
  theme: DEFAULT_THEME,
  snapToGrid: false,
  gridSize: 20,
  viewport: DEFAULT_VIEWPORT,
}

function makeCanvasStateKey(sessionId: string, directory?: string) {
  // Include directory in key so different workspaces get fresh canvas even if session IDs overlap
  const dirSuffix = directory ? `:${directory.replace(/\//g, '_')}` : ''
  return `orxa:canvasState:${sessionId}${dirSuffix}:v2`
}

function clampCanvasZoom(zoom: number) {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom))
}

function normalizeCanvasState(value: unknown): CanvasSessionState {
  if (!value || typeof value !== 'object') {
    return DEFAULT_STATE
  }

  const candidate = value as Partial<CanvasSessionState>
  const tiles = Array.isArray(candidate.tiles) ? candidate.tiles : DEFAULT_STATE.tiles

  // Migrate old defaults to new glass theme
  const rawTheme = candidate.theme ?? {}
  const presetId = (rawTheme as Record<string, unknown>).preset
  const bg = (rawTheme as Record<string, unknown>).background
  const needsMigration =
    (presetId === 'midnight' && bg === '#0C0C0C') ||
    (presetId === 'glass' && typeof bg === 'string' && bg.includes('#141418'))
  const migratedTheme = needsMigration ? { ...DEFAULT_THEME } : { ...DEFAULT_THEME, ...rawTheme }

  return {
    tiles,
    theme: migratedTheme,
    snapToGrid:
      typeof candidate.snapToGrid === 'boolean' ? candidate.snapToGrid : DEFAULT_STATE.snapToGrid,
    gridSize: typeof candidate.gridSize === 'number' ? candidate.gridSize : DEFAULT_STATE.gridSize,
    viewport: {
      ...DEFAULT_VIEWPORT,
      ...(candidate.viewport ?? {}),
      zoom: clampCanvasZoom(
        typeof candidate.viewport?.zoom === 'number'
          ? candidate.viewport.zoom
          : DEFAULT_VIEWPORT.zoom
      ),
    },
  }
}

export function useCanvasState(sessionId: string, directory?: string) {
  const [state, setState] = usePersistedState<CanvasSessionState>(makeCanvasStateKey(sessionId, directory), DEFAULT_STATE, {
    deserialize: raw => normalizeCanvasState(JSON.parse(raw)),
  })

  const addTile = useCallback(
    (tile: Omit<CanvasTile, 'zIndex'>) => {
      setState(prev => {
        const maxZ = prev.tiles.reduce((max, t) => Math.max(max, t.zIndex), 0)
        return {
          ...prev,
          tiles: [...prev.tiles, { ...tile, zIndex: maxZ + 1 }],
        }
      })
    },
    [setState]
  )

  const removeTile = useCallback(
    (tileId: string) => {
      setState(prev => ({
        ...prev,
        tiles: prev.tiles.filter(t => t.id !== tileId),
      }))
    },
    [setState]
  )

  const updateTile = useCallback(
    (tileId: string, updates: Partial<Omit<CanvasTile, 'id'>>) => {
      setState(prev => ({
        ...prev,
        tiles: prev.tiles.map(t => (t.id === tileId ? { ...t, ...updates } : t)),
      }))
    },
    [setState]
  )

  const bringToFront = useCallback(
    (tileId: string) => {
      setState(prev => {
        const maxZ = prev.tiles.reduce((max, t) => Math.max(max, t.zIndex), 0)
        return {
          ...prev,
          tiles: prev.tiles.map(t => (t.id === tileId ? { ...t, zIndex: maxZ + 1 } : t)),
        }
      })
    },
    [setState]
  )

  const setTheme = useCallback(
    (theme: Partial<CanvasTheme>) => {
      setState(prev => ({
        ...prev,
        theme: { ...prev.theme, ...theme },
      }))
    },
    [setState]
  )

  const toggleSnap = useCallback(() => {
    setState(prev => ({ ...prev, snapToGrid: !prev.snapToGrid }))
  }, [setState])

  const setViewport = useCallback(
    (viewport: Partial<CanvasViewport>) => {
      setState(prev => ({
        ...prev,
        viewport: {
          ...prev.viewport,
          ...viewport,
          zoom: clampCanvasZoom(viewport.zoom ?? prev.viewport.zoom),
        },
      }))
    },
    [setState]
  )

  const resetViewport = useCallback(() => {
    setState(prev => ({
      ...prev,
      viewport: DEFAULT_VIEWPORT,
    }))
  }, [setState])

  const setTiles = useCallback(
    (tiles: CanvasTile[]) => {
      setState(prev => ({
        ...prev,
        tiles,
      }))
    },
    [setState]
  )

  return {
    tiles: state.tiles, theme: state.theme, snapToGrid: state.snapToGrid,
    gridSize: state.gridSize, viewport: state.viewport, addTile, removeTile, updateTile,
    setTiles, bringToFront, setTheme, toggleSnap, setViewport, resetViewport,
  }
}
