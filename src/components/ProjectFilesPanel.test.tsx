import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectFilesPanel } from './ProjectFilesPanel'

describe('ProjectFilesPanel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        opencode: {
          listFiles: vi.fn(async () => [
            {
              name: 'notes.md',
              path: '/repo/notes.md',
              relativePath: 'notes.md',
              type: 'file',
            },
          ]),
          countProjectFiles: vi.fn(async () => 1),
          readProjectFile: vi.fn(async () => ({
            path: '/repo/notes.md',
            relativePath: 'notes.md',
            content: 'hello\nworld',
            binary: false,
            truncated: false,
          })),
        },
        app: {
          writeTextFile: vi.fn(async () => true),
        },
      },
    })
  })

  it('allows editing and saving a previewed file', async () => {
    const onAddToChatPath = vi.fn()
    const onStatus = vi.fn()

    render(
      <ProjectFilesPanel directory="/repo" onAddToChatPath={onAddToChatPath} onStatus={onStatus} />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'notes.md' }))
    expect(await screen.findByText('notes.md')).toBeInTheDocument()

    const editor = await screen.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'hello\nchanged' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))

    await waitFor(() => {
      expect(window.orxa?.app.writeTextFile).toHaveBeenCalledWith(
        '/repo/notes.md',
        'hello\nchanged'
      )
    })
  })
})
