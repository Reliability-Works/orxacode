import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { arrangeCanvasTilesInGrid, sortCanvasTilesForLayout } from '../lib/canvas-layout'
import { CanvasPane, type CanvasPaneCanvasState } from './CanvasPane'
import type { CanvasTile, CanvasTheme } from '../types/canvas'
import {
  DEFAULT_CANVAS_SCROLL_LEFT,
  DEFAULT_CANVAS_SCROLL_TOP,
  DEFAULT_CANVAS_ZOOM,
} from '../types/canvas'

const DEFAULT_THEME: CanvasTheme = {
  preset: 'midnight',
  background: '#0C0C0C',
  tileBorder: '#1F1F1F',
  accent: '#22C55E',
}

function buildCanvasState(overrides: Partial<CanvasPaneCanvasState> = {}): CanvasPaneCanvasState {
  return {
    tiles: [],
    theme: DEFAULT_THEME,
    snapToGrid: false,
    gridSize: 12,
    viewport: {
      zoom: DEFAULT_CANVAS_ZOOM,
      scrollLeft: DEFAULT_CANVAS_SCROLL_LEFT,
      scrollTop: DEFAULT_CANVAS_SCROLL_TOP,
    },
    addTile: vi.fn(),
    removeTile: vi.fn(),
    updateTile: vi.fn(),
    bringToFront: vi.fn(),
    setTiles: vi.fn(),
    toggleSnap: vi.fn(),
    setTheme: vi.fn(),
    setViewport: vi.fn(),
    resetViewport: vi.fn(),
    ...overrides,
  }
}

function makeTile(overrides: Partial<CanvasTile> = {}): CanvasTile {
  return {
    id: 'tile-1',
    type: 'browser',
    x: 40,
    y: 40,
    width: 548,
    height: 380,
    zIndex: 1,
    minimized: false,
    maximized: false,
    meta: { url: 'about:blank' },
    ...overrides,
  }
}

function registerCanvasPaneBasicsTests() {
  it('renders canvas toolbar with add tile button', () => {
    const state = buildCanvasState()
    render(<CanvasPane canvasState={state} />)
    const hub = screen.getByRole('button', { name: 'Canvas controls' })
    fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(document, { clientX: 0, clientY: 0 })
    expect(screen.getByRole('menuitem', { name: 'Add tile' })).toBeInTheDocument()
  })

  it('displays the tile count from canvasState', () => {
    const state = buildCanvasState({ tiles: [makeTile(), makeTile({ id: 'tile-2' })] })
    render(<CanvasPane canvasState={state} />)

    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('renders tiles from canvasState', () => {
    const tile = makeTile({ type: 'browser', meta: { url: 'about:blank' } })
    const state = buildCanvasState({ tiles: [tile] })
    render(<CanvasPane canvasState={state} />)
    expect(screen.getByText('browser')).toBeInTheDocument()
  })
}

function registerCanvasPaneAddTileTests() {
  it('adds a terminal tile with correct meta including directory', () => {
    const addTile = vi.fn()
    const state = buildCanvasState({ addTile })
    render(<CanvasPane canvasState={state} directory="/workspace/project" />)

    const hub = screen.getByRole('button', { name: 'Canvas controls' })
    fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(document, { clientX: 0, clientY: 0 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add tile' }))
    fireEvent.click(screen.getByText('terminal'))

    expect(addTile).toHaveBeenCalledTimes(1)
    const call = addTile.mock.calls[0][0]
    expect(call.type).toBe('terminal')
    expect(call.meta).toEqual(
      expect.objectContaining({ directory: '/workspace/project', cwd: '/workspace/project' })
    )
  })

  it('adds a browser tile with correct meta', () => {
    const addTile = vi.fn()
    const state = buildCanvasState({ addTile })
    render(<CanvasPane canvasState={state} directory="/workspace/project" />)

    const hub = screen.getByRole('button', { name: 'Canvas controls' })
    fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(document, { clientX: 0, clientY: 0 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add tile' }))
    fireEvent.click(screen.getByText('browser'))

    const call = addTile.mock.calls[0][0]
    expect(call.type).toBe('browser')
    expect(call.meta).toEqual(expect.objectContaining({ url: 'about:blank' }))
  })

  it('adds a file_editor tile with correct meta including directory', () => {
    const addTile = vi.fn()
    const state = buildCanvasState({ addTile })
    render(<CanvasPane canvasState={state} directory="/workspace/project" />)

    const hub = screen.getByRole('button', { name: 'Canvas controls' })
    fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(document, { clientX: 0, clientY: 0 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add tile' }))
    fireEvent.click(screen.getByText('file editor'))

    const call = addTile.mock.calls[0][0]
    expect(call.type).toBe('file_editor')
    expect(call.meta).toEqual(
      expect.objectContaining({ directory: '/workspace/project', filePath: '' })
    )
  })

  it('adds a dev_server tile with correct meta', () => {
    const addTile = vi.fn()
    const state = buildCanvasState({ addTile })
    render(<CanvasPane canvasState={state} directory="/workspace/project" />)

    const hub = screen.getByRole('button', { name: 'Canvas controls' })
    fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(document, { clientX: 0, clientY: 0 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add tile' }))
    fireEvent.click(screen.getByText('dev server'))

    const call = addTile.mock.calls[0][0]
    expect(call.type).toBe('dev_server')
    expect(call.meta).toEqual(
      expect.objectContaining({ directory: '/workspace/project', port: 3000, status: 'stopped' })
    )
  })
}

function registerCanvasPaneContentTileTests() {
  it('adds a markdown_preview tile with correct meta', () => {
    const addTile = vi.fn()
    const state = buildCanvasState({ addTile })
    render(<CanvasPane canvasState={state} directory="/workspace/project" />)

    const hub = screen.getByRole('button', { name: 'Canvas controls' })
    fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(document, { clientX: 0, clientY: 0 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add tile' }))
    fireEvent.click(screen.getByText('markdown preview'))

    const call = addTile.mock.calls[0][0]
    expect(call.type).toBe('markdown_preview')
    expect(call.meta).toEqual(
      expect.objectContaining({ directory: '/workspace/project', filePath: '', content: '' })
    )
  })

  it('adds an image_viewer tile with correct meta', () => {
    const addTile = vi.fn()
    const state = buildCanvasState({ addTile })
    render(<CanvasPane canvasState={state} directory="/workspace/project" />)

    const hub = screen.getByRole('button', { name: 'Canvas controls' })
    fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(document, { clientX: 0, clientY: 0 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add tile' }))
    fireEvent.click(screen.getByText('image viewer'))

    const call = addTile.mock.calls[0][0]
    expect(call.type).toBe('image_viewer')
    expect(call.meta).toEqual(expect.objectContaining({ filePath: '' }))
  })

  it('adds an api_tester tile with correct meta', () => {
    const addTile = vi.fn()
    const state = buildCanvasState({ addTile })
    render(<CanvasPane canvasState={state} directory="/workspace/project" />)

    const hub = screen.getByRole('button', { name: 'Canvas controls' })
    fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(document, { clientX: 0, clientY: 0 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add tile' }))
    fireEvent.click(screen.getByText('api tester'))

    const call = addTile.mock.calls[0][0]
    expect(call.type).toBe('api_tester')
    expect(call.meta).toEqual(expect.objectContaining({ method: 'GET', url: '' }))
  })
}

function registerCanvasPaneCliTileTests() {
  it('adds a claude code tile with the expected startup command metadata', () => {
    const addTile = vi.fn()
    const state = buildCanvasState({ addTile })
    render(<CanvasPane canvasState={state} directory="/workspace/project" />)

    const hub = screen.getByRole('button', { name: 'Canvas controls' })
    fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(document, { clientX: 0, clientY: 0 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add tile' }))
    fireEvent.click(screen.getByText('claude code'))

    const call = addTile.mock.calls[0][0]
    expect(call.type).toBe('claude_code')
    expect(call.meta).toEqual(
      expect.objectContaining({
        directory: '/workspace/project',
        cwd: '/workspace/project',
        startupCommand:
          'env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY claude\n',
        startupFilter: 'claude',
      })
    )
  })

  it('adds codex and opencode CLI tiles with startup commands', () => {
    const addTile = vi.fn()
    const state = buildCanvasState({ addTile })
    render(<CanvasPane canvasState={state} directory="/workspace/project" />)

    const hub = screen.getByRole('button', { name: 'Canvas controls' })
    fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(document, { clientX: 0, clientY: 0 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add tile' }))
    fireEvent.click(screen.getByText('codex cli'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add tile' }))
    fireEvent.click(screen.getByText('opencode'))

    expect(addTile.mock.calls[0][0]).toMatchObject({
      type: 'codex_cli',
      meta: expect.objectContaining({
        directory: '/workspace/project',
        cwd: '/workspace/project',
        startupCommand: 'codex\n',
      }),
    })
    expect(addTile.mock.calls[1][0]).toMatchObject({
      type: 'opencode_cli',
      meta: expect.objectContaining({
        directory: '/workspace/project',
        cwd: '/workspace/project',
        startupCommand: 'opencode\n',
      }),
    })
  })
}

function registerCanvasPaneLayoutTests() {
  it('renders zoom controls', () => {
    const state = buildCanvasState()
    render(<CanvasPane canvasState={state} />)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('shows jump to control in the bottom zoom row when tiles exist', () => {
    const state = buildCanvasState({ tiles: [makeTile()] })
    render(<CanvasPane canvasState={state} />)

    expect(screen.getByRole('button', { name: 'Jump to tile' })).toBeInTheDocument()
  })

  it('shows manage control in its own bottom pill when tiles exist', () => {
    const state = buildCanvasState({ tiles: [makeTile()] })
    render(<CanvasPane canvasState={state} />)

    expect(screen.getByRole('button', { name: 'Manage tiles' })).toBeInTheDocument()
  })

  it('sorts tiles by type before arranging them', () => {
    const tiles = [
      makeTile({ id: 'tile-2', type: 'terminal', meta: { createdAt: 2 } }),
      makeTile({ id: 'tile-1', type: 'browser', meta: { createdAt: 1 } }),
    ]

    const sorted = sortCanvasTilesForLayout(tiles, 'type')

    expect(sorted.map(tile => tile.id)).toEqual(['tile-1', 'tile-2'])
  })

  it('sorts tiles by created time before arranging them', () => {
    const tiles = [
      makeTile({ id: 'tile-2', type: 'terminal', meta: { createdAt: 2 } }),
      makeTile({ id: 'tile-1', type: 'browser', meta: { createdAt: 1 } }),
    ]

    const sorted = sortCanvasTilesForLayout(tiles, 'created')

    expect(sorted.map(tile => tile.id)).toEqual(['tile-1', 'tile-2'])
  })

  it('arranges sorted tiles into a wrapped grid', () => {
    const tiles = [
      makeTile({ id: 'tile-1', width: 400, height: 200 }),
      makeTile({ id: 'tile-2', width: 400, height: 220 }),
      makeTile({ id: 'tile-3', width: 400, height: 180 }),
    ]

    const arranged = arrangeCanvasTilesInGrid(tiles, 100, 200, 900)

    expect(arranged[0]).toMatchObject({ id: 'tile-1', x: 100, y: 200 })
    expect(arranged[1]).toMatchObject({ id: 'tile-2', x: 532, y: 200 })
    expect(arranged[2]).toMatchObject({ id: 'tile-3', x: 100, y: 452 })
  })
}

function registerCanvasPaneViewportTests() {
  it('updates viewport state when canvas is scrolled', async () => {
    const setViewport = vi.fn()
    const state = buildCanvasState({ setViewport })
    const { container } = render(<CanvasPane canvasState={state} />)
    const viewport = container.querySelector('.canvas-area-viewport') as HTMLDivElement

    await new Promise<void>(resolve => {
      window.requestAnimationFrame(() => resolve())
    })
    Object.defineProperty(viewport, 'scrollLeft', { configurable: true, writable: true, value: 420 })
    Object.defineProperty(viewport, 'scrollTop', { configurable: true, writable: true, value: 360 })
    fireEvent.scroll(viewport)

    expect(setViewport).toHaveBeenCalledWith({ scrollLeft: 420, scrollTop: 360 })
  })

  it('zooms in and out from toolbar controls', () => {
    const setViewport = vi.fn()
    const state = buildCanvasState({ setViewport })
    render(<CanvasPane canvasState={state} />)

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))

    expect(setViewport).toHaveBeenCalled()
  })

  it('keeps consecutive wheel zoom steps anchored to the latest cursor position state', () => {
    const setViewport = vi.fn()
    const state = buildCanvasState({
      setViewport,
      viewport: {
        zoom: DEFAULT_CANVAS_ZOOM,
        scrollLeft: DEFAULT_CANVAS_SCROLL_LEFT,
        scrollTop: DEFAULT_CANVAS_SCROLL_TOP,
      },
    })
    const { container } = render(<CanvasPane canvasState={state} />)
    const viewport = container.querySelector('.canvas-area-viewport') as HTMLDivElement

    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(viewport, 'scrollLeft', {
      configurable: true,
      writable: true,
      value: DEFAULT_CANVAS_SCROLL_LEFT,
    })
    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      writable: true,
      value: DEFAULT_CANVAS_SCROLL_TOP,
    })
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      toJSON: () => ({}),
    })

    fireEvent.wheel(viewport, {
      metaKey: true,
      deltaY: -100,
      clientX: 560,
      clientY: 260,
    })
    const firstZoomStep = setViewport.mock.calls.at(-1)?.[0]

    fireEvent.wheel(viewport, {
      metaKey: true,
      deltaY: -100,
      clientX: 560,
      clientY: 260,
    })
    const secondZoomStep = setViewport.mock.calls.at(-1)?.[0]

    expect(firstZoomStep.zoom).toBeGreaterThan(DEFAULT_CANVAS_ZOOM)
    expect(secondZoomStep.zoom).toBeGreaterThan(firstZoomStep.zoom)
    expect(secondZoomStep.scrollLeft).toBeGreaterThan(firstZoomStep.scrollLeft)
    expect(secondZoomStep.scrollTop).toBeGreaterThan(firstZoomStep.scrollTop)
  })
}

describe('CanvasPane', () => {
  registerCanvasPaneBasicsTests()
  registerCanvasPaneAddTileTests()
  registerCanvasPaneContentTileTests()
  registerCanvasPaneCliTileTests()
  registerCanvasPaneLayoutTests()
  registerCanvasPaneViewportTests()
})
