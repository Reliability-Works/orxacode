// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./ui/button', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}))
vi.mock('./ui/button.tsx', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}))
vi.mock('../rpc/wsConnectionState', () => ({
  getWsConnectionUiState: () => 'connected',
  useWsConnectionStatus: () => ({
    online: true,
    lastError: null,
  }),
}))

describe('WebSocketConnectionSurface', () => {
  it('wraps the app shell in a flex child that can fill the viewport', async () => {
    const { WebSocketConnectionSurface } = await import('./WebSocketConnectionSurface')
    const { container } = render(
      <WebSocketConnectionSurface>
        <div data-testid="app-shell">shell</div>
      </WebSocketConnectionSurface>
    )

    const root = container.firstElementChild
    expect(root?.className).toContain('h-svh')

    const shellSlot = screen.getByTestId('app-shell').parentElement
    expect(shellSlot?.className).toContain('flex-1')
    expect(shellSlot?.className).toContain('min-h-0')
  })
})
