import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CanvasThemePicker, CANVAS_PRESETS } from './CanvasThemePicker'
import type { CanvasTheme } from '../types/canvas'

const DEFAULT_THEME: CanvasTheme = {
  preset: 'midnight',
  background: '#0C0C0C',
  tileBorder: '#1F1F1F',
  accent: '#22C55E',
}

function renderPicker(
  themeOverrides: Partial<CanvasTheme> = {},
  handlers: { onThemeChange?: (theme: Partial<CanvasTheme>) => void; onClose?: () => void } = {}
) {
  const onThemeChange =
    handlers.onThemeChange ?? (vi.fn() as unknown as (theme: Partial<CanvasTheme>) => void)
  const onClose = handlers.onClose ?? (vi.fn() as unknown as () => void)
  const theme = { ...DEFAULT_THEME, ...themeOverrides }

  render(<CanvasThemePicker theme={theme} onThemeChange={onThemeChange} onClose={onClose} />)

  return { onThemeChange, onClose }
}

describe('CanvasThemePicker', () => {
  it('renders all 6 preset swatches', () => {
    renderPicker()
    for (const preset of CANVAS_PRESETS) {
      expect(
        screen.getByRole('button', { name: `Apply ${preset.label} theme` })
      ).toBeInTheDocument()
    }
  })

  it('active preset has aria-pressed true', () => {
    renderPicker({ preset: 'charcoal' })
    const charcoalBtn = screen.getByRole('button', { name: 'Apply charcoal theme' })
    expect(charcoalBtn).toHaveAttribute('aria-pressed', 'true')

    const midnightBtn = screen.getByRole('button', { name: 'Apply midnight theme' })
    expect(midnightBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking a preset calls onThemeChange with preset data', () => {
    const { onThemeChange } = renderPicker()
    const deepNavy = CANVAS_PRESETS.find(p => p.id === 'deep_navy')!
    fireEvent.click(screen.getByRole('button', { name: `Apply ${deepNavy.label} theme` }))

    expect(onThemeChange).toHaveBeenCalledWith({
      preset: deepNavy.id,
      background: deepNavy.background,
      tileBorder: deepNavy.tileBorder,
      accent: deepNavy.accent,
    })
  })

  it('renders 3 custom color rows (background, tile_border, accent)', () => {
    renderPicker()
    expect(screen.getByText('background')).toBeInTheDocument()
    expect(screen.getByText('tile_border')).toBeInTheDocument()
    expect(screen.getByText('accent')).toBeInTheDocument()
  })

  it('escape key calls onClose', () => {
    const { onClose } = renderPicker()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('close button calls onClose', () => {
    const { onClose } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Close theme picker' }))
    expect(onClose).toHaveBeenCalled()
  })
})
