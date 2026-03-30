import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InteractionCard } from './InteractionCard'

describe('InteractionCard', () => {
  it('selects an option on mouse down so the choice paints immediately', () => {
    render(
      <InteractionCard
        title="Implement this plan?"
        options={[
          { id: 'accept', label: 'Yes, implement this plan' },
          { id: 'change', label: 'No, and tell Codex what to do differently', isCustomInput: true },
        ]}
        onSubmit={() => undefined}
        onDismiss={() => undefined}
      />
    )

    const acceptButton = screen.getByRole('button', { name: /yes, implement this plan/i })
    fireEvent.mouseDown(acceptButton)

    expect(acceptButton.className).toContain('interaction-card-option--selected')
  })

  it('disables submit immediately and defers parent submit to the next task', () => {
    vi.useFakeTimers()
    const onSubmit = vi.fn()

    render(
      <InteractionCard
        title="Implement this plan?"
        options={[
          { id: 'accept', label: 'Yes, implement this plan' },
          { id: 'change', label: 'No, and tell Codex what to do differently', isCustomInput: true },
        ]}
        onSubmit={onSubmit}
        onDismiss={() => undefined}
      />
    )

    const acceptButton = screen.getByRole('button', { name: /yes, implement this plan/i })
    const submitButton = screen.getByRole('button', { name: /submit/i })

    fireEvent.mouseDown(acceptButton)
    fireEvent.click(submitButton)

    expect(submitButton).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()

    vi.runAllTimers()

    expect(onSubmit).toHaveBeenCalledWith('accept', undefined)
    vi.useRealTimers()
  })
})
