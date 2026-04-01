import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CanvasTileComponent } from './CanvasTile'
import type { CanvasTile, CanvasTheme } from '../types/canvas'

const DEFAULT_THEME: CanvasTheme = {
  preset: 'midnight',
  background: '#0C0C0C',
  tileBorder: '#1F1F1F',
  accent: '#22C55E',
}

function makeTile(overrides: Partial<CanvasTile> = {}): CanvasTile {
  return {
    id: 'tile-1',
    type: 'browser',
    x: 40,
    y: 40,
    width: 500,
    height: 400,
    zIndex: 1,
    minimized: false,
    maximized: false,
    meta: {},
    ...overrides,
  }
}

function renderTile(
  tileOverrides: Partial<CanvasTile> = {},
  handlers: {
    onUpdate?: (id: string, patch: Partial<CanvasTile>) => void
    onRemove?: (id: string) => void
    onBringToFront?: (id: string) => void
  } = {}
) {
  const onUpdate =
    handlers.onUpdate ?? (vi.fn() as unknown as (id: string, patch: Partial<CanvasTile>) => void)
  const onRemove = handlers.onRemove ?? (vi.fn() as unknown as (id: string) => void)
  const onBringToFront = handlers.onBringToFront ?? (vi.fn() as unknown as (id: string) => void)
  const tile = makeTile(tileOverrides)

  render(
    <CanvasTileComponent
      tile={tile}
      canvasTheme={DEFAULT_THEME}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onBringToFront={onBringToFront}
      icon={<span data-testid="tile-icon">B</span>}
      label="browser"
      iconColor="#3B82F6"
      metadata="localhost"
    >
      <div data-testid="tile-content">content</div>
    </CanvasTileComponent>
  )

  return { tile, onUpdate, onRemove, onBringToFront }
}

describe('CanvasTileComponent', () => {
  it('renders header with icon, label, and metadata', () => {
    renderTile()
    expect(screen.getByTestId('tile-icon')).toBeInTheDocument()
    expect(screen.getByText('browser')).toBeInTheDocument()
    expect(screen.getByText('localhost')).toBeInTheDocument()
  })

  it('renders tile body content', () => {
    renderTile()
    expect(screen.getByTestId('tile-content')).toBeInTheDocument()
  })

  it('minimize button toggles minimized state', () => {
    const onUpdate = vi.fn()
    renderTile({}, { onUpdate })

    fireEvent.click(screen.getByTitle('Minimize'))
    expect(onUpdate).toHaveBeenCalledWith('tile-1', { minimized: true, maximized: false })
  })

  it('minimize button restores when already minimized', () => {
    const onUpdate = vi.fn()
    renderTile({ minimized: true }, { onUpdate })

    fireEvent.click(screen.getByTitle('Restore'))
    expect(onUpdate).toHaveBeenCalledWith('tile-1', { minimized: false, maximized: false })
  })

  it('maximize button toggles maximized state', () => {
    const onUpdate = vi.fn()
    renderTile({}, { onUpdate })

    fireEvent.click(screen.getByTitle('Maximize'))
    expect(onUpdate).toHaveBeenCalledWith(
      'tile-1',
      expect.objectContaining({ maximized: true, minimized: false })
    )
  })

  it('close button calls onRemove', () => {
    const onRemove = vi.fn()
    renderTile({}, { onRemove })

    fireEvent.click(screen.getByTitle('Close'))
    expect(onRemove).toHaveBeenCalledWith('tile-1')
  })

  it('hides tile body when minimized', () => {
    renderTile({ minimized: true })
    expect(screen.queryByTestId('tile-content')).not.toBeInTheDocument()
  })

  it('shows tile body when not minimized', () => {
    renderTile({ minimized: false })
    expect(screen.getByTestId('tile-content')).toBeInTheDocument()
  })

  it('mousedown on tile calls onBringToFront', () => {
    const onBringToFront = vi.fn()
    renderTile({}, { onBringToFront })

    const tile = screen.getByText('browser').closest('.canvas-tile')!
    fireEvent.mouseDown(tile)
    expect(onBringToFront).toHaveBeenCalledWith('tile-1')
  })

  it('does not render resize handles when maximized', () => {
    const { container } = render(
      <CanvasTileComponent
        tile={makeTile({ maximized: true })}
        canvasTheme={DEFAULT_THEME}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onBringToFront={vi.fn()}
        icon={null}
        label="test"
        iconColor="#fff"
      >
        <div>body</div>
      </CanvasTileComponent>
    )
    expect(container.querySelectorAll('.canvas-tile-resize')).toHaveLength(0)
  })
})
