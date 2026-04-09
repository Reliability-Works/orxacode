import type { DesktopBrowserBounds } from '@orxa-code/contracts'

export function scaleCssBoundsToWindowDips(
  bounds: DesktopBrowserBounds,
  zoomFactor: number
): DesktopBrowserBounds {
  const safeZoomFactor = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
  return {
    x: Math.round(bounds.x * safeZoomFactor),
    y: Math.round(bounds.y * safeZoomFactor),
    width: Math.round(bounds.width * safeZoomFactor),
    height: Math.round(bounds.height * safeZoomFactor),
  }
}

export function normalizeWindowContentBounds(bounds: DesktopBrowserBounds): DesktopBrowserBounds {
  return {
    x: 0,
    y: 0,
    width: Math.max(0, Math.floor(bounds.width)),
    height: Math.max(0, Math.floor(bounds.height)),
  }
}

export function clampBoundsToWindow(
  bounds: DesktopBrowserBounds,
  windowBounds: DesktopBrowserBounds
): DesktopBrowserBounds {
  const normalizedWindowBounds = normalizeWindowContentBounds(windowBounds)
  const x = Math.min(Math.max(0, Math.floor(bounds.x)), normalizedWindowBounds.width)
  const y = Math.min(Math.max(0, Math.floor(bounds.y)), normalizedWindowBounds.height)
  const width = Math.min(
    Math.max(0, Math.floor(bounds.width)),
    Math.max(0, normalizedWindowBounds.width - x)
  )
  const height = Math.min(
    Math.max(0, Math.floor(bounds.height)),
    Math.max(0, normalizedWindowBounds.height - y)
  )
  return { x, y, width, height }
}
