import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueuedMessagesDock } from './QueuedMessagesDock'
import type { QueuedMessage } from './QueuedMessagesDock'

const makeQueuedMessages = (): QueuedMessage[] => [
  { id: 'q1', text: 'First queued message', timestamp: 1700000000000 },
  { id: 'q2', text: 'Second queued message', timestamp: 1700000060000 },
]

describe('QueuedMessagesDock basics', () => {
  it('renders nothing when messages array is empty', () => {
    const { container } = render(
      <QueuedMessagesDock
        messages={[]}
        onPrimaryAction={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders header with count for single message', () => {
    render(
      <QueuedMessagesDock
        messages={[makeQueuedMessages()[0]]}
        onPrimaryAction={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />
    )
    expect(screen.getByText('1 followup message queued')).toBeInTheDocument()
  })

  it('renders header with plural count for multiple messages', () => {
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        onPrimaryAction={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />
    )
    expect(screen.getByText('2 followup messages queued')).toBeInTheDocument()
  })

  it('renders message text for each queued item', () => {
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        onPrimaryAction={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />
    )
    expect(screen.getByText('First queued message')).toBeInTheDocument()
    expect(screen.getByText('Second queued message')).toBeInTheDocument()
  })

  it('calls onPrimaryAction with the correct id when Steer is clicked', () => {
    const onPrimaryAction = vi.fn()
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        actionKind="steer"
        onPrimaryAction={onPrimaryAction}
        onEdit={() => {}}
        onRemove={() => {}}
      />
    )
    const steerButtons = screen.getAllByRole('button', { name: 'Steer message' })
    fireEvent.click(steerButtons[0])
    expect(onPrimaryAction).toHaveBeenCalledWith('q1')
  })

  it('calls onEdit with the correct id when Edit is clicked', () => {
    const onEdit = vi.fn()
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        onPrimaryAction={() => {}}
        onEdit={onEdit}
        onRemove={() => {}}
      />
    )
    const editButtons = screen.getAllByRole('button', { name: 'Edit message' })
    fireEvent.click(editButtons[1])
    expect(onEdit).toHaveBeenCalledWith('q2')
  })

  it('calls onRemove with the correct id when remove button is clicked', () => {
    const onRemove = vi.fn()
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        onPrimaryAction={() => {}}
        onEdit={() => {}}
        onRemove={onRemove}
      />
    )
    const removeButtons = screen.getAllByRole('button', { name: 'Remove from queue' })
    fireEvent.click(removeButtons[0])
    expect(onRemove).toHaveBeenCalledWith('q1')
  })
})

describe('QueuedMessagesDock state', () => {
  it('truncates long message text at 60 chars', () => {
    const longText = 'A'.repeat(70)
    render(
      <QueuedMessagesDock
        messages={[{ id: 'q1', text: longText, timestamp: Date.now() }]}
        onPrimaryAction={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />
    )
    const displayed = screen.getByText(/A+\u2026/)
    expect(displayed).toBeInTheDocument()
    expect(displayed.textContent?.length).toBeLessThanOrEqual(61)
  })

  it('disables Steer buttons while sendingId is set', () => {
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        sendingId="q1"
        actionKind="steer"
        onPrimaryAction={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />
    )
    const steerButtons = screen.getAllByRole('button', { name: /Steer message/ })
    for (const btn of steerButtons) {
      expect(btn).toBeDisabled()
    }
  })

  it("shows 'Steering' label on the in-flight item", () => {
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        sendingId="q1"
        actionKind="steer"
        onPrimaryAction={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />
    )
    expect(screen.getByText('Steering')).toBeInTheDocument()
  })

  it('renders queued-messages-dock class', () => {
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        onPrimaryAction={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />
    )
    expect(document.querySelector('.queued-messages-dock')).toBeTruthy()
  })

  it('renders one queued-message-item per message', () => {
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        onPrimaryAction={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />
    )
    expect(document.querySelectorAll('.queued-message-item')).toHaveLength(2)
  })
})
