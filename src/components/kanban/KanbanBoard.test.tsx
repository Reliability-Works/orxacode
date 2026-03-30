import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KanbanCreateTaskInput } from '@shared/ipc'
import { KanbanBoard } from './KanbanBoard'
import {
  createTask,
  getLastKanbanEventListener,
  installKanbanWindowMocks,
} from './kanban-board-test-utils'

beforeEach(() => {
  window.localStorage.clear()
})

describe('KanbanBoard event handling', () => {
  it('refreshes the board and open detail modal on runtime events for the selected workspace', async () => {
    const { subscribe, getBoard, getTaskDetail } = installKanbanWindowMocks()

    render(<KanbanBoard />)

    await waitFor(() => {
      expect(getBoard).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByText('Task 1'))

    await waitFor(() => {
      expect(getTaskDetail).toHaveBeenCalledTimes(1)
    })

    const listener = getLastKanbanEventListener(subscribe)
    expect(listener).toBeTypeOf('function')
    if (!listener) {
      throw new Error('Expected KanbanBoard to register an events listener')
    }

    listener({
      type: 'kanban.runtime',
      payload: {
        workspaceDir: '/repo/kanban',
        runtime: { taskId: 'task-1', status: 'running' },
      },
    })

    await waitFor(() => {
      expect(getBoard).toHaveBeenCalledTimes(2)
      expect(getTaskDetail).toHaveBeenCalledTimes(2)
    })
  })

  it('does not reopen a task modal after it has been explicitly closed', async () => {
    const { subscribe, getTaskDetail } = installKanbanWindowMocks()

    render(<KanbanBoard />)
    fireEvent.click(await screen.findByText('Task 1'))

    await screen.findByRole('button', { name: 'X' })
    fireEvent.click(screen.getByRole('button', { name: 'X' }))

    await waitFor(() => {
      expect(screen.queryByText('Overview')).not.toBeInTheDocument()
    })

    const listener = getLastKanbanEventListener(subscribe)
    if (!listener) {
      throw new Error('Expected KanbanBoard to register an events listener')
    }

    listener({
      type: 'kanban.runtime',
      payload: {
        workspaceDir: '/repo/kanban',
        runtime: { taskId: 'task-1', status: 'running' },
      },
    })

    await waitFor(() => {
      expect(getTaskDetail).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Overview')).not.toBeInTheDocument()
    })
  })
})

describe('KanbanBoard dependency interactions', () => {
  it('creates task dependencies by dragging from one card anchor to another', async () => {
    const { linkTasks } = installKanbanWindowMocks({
      tasks: [
        { id: 'task-a', title: 'Inventory Deployable Sites' },
        { id: 'task-b', title: 'Cross-Site Build Matrix', position: 1 },
      ],
    })

    render(<KanbanBoard />)
    await screen.findByText('Inventory Deployable Sites')

    const anchors = screen.getAllByTitle('Drag to another task to create a dependency')
    fireEvent.pointerDown(anchors[0]!)
    fireEvent.pointerEnter(anchors[1]!)
    fireEvent.pointerUp(anchors[1]!)

    await waitFor(() => {
      expect(linkTasks).toHaveBeenCalledWith('/repo/kanban', 'task-a', 'task-b')
    })
  })

  it('removes dependencies directly from the board edge controls', async () => {
    const { unlinkTasks } = installKanbanWindowMocks({
      tasks: [
        { id: 'task-a', title: 'Inventory Deployable Sites' },
        { id: 'task-b', title: 'Cross-Site Build Matrix', position: 1 },
      ],
      dependencies: [
        {
          id: 'dep-1',
          workspaceDir: '/repo/kanban',
          fromTaskId: 'task-a',
          toTaskId: 'task-b',
          createdAt: Date.now(),
        },
      ],
    })

    render(<KanbanBoard />)
    await screen.findByText('Inventory Deployable Sites')

    let edgeHit: Element | null = null
    await waitFor(() => {
      edgeHit = document.querySelector('[data-dependency-edge-hit="dep-1"]')
      expect(edgeHit).toBeInstanceOf(SVGElement)
    })
    const svgEdge = edgeHit as SVGElement | null
    if (!svgEdge) {
      throw new Error('Expected dependency edge to render')
    }
    fireEvent.pointerEnter(svgEdge)
    fireEvent.click(svgEdge)

    await waitFor(() => {
      expect(unlinkTasks).toHaveBeenCalledWith('/repo/kanban', 'task-a', 'task-b')
    })
  })
})

describe('KanbanBoard task creation', () => {
  it('regenerates create-task fields with the selected provider', async () => {
    const { runAgentCli } = installKanbanWindowMocks({
      runAgentCliOutput: 'Inventory deployable sites',
    })

    render(<KanbanBoard />)
    fireEvent.click(await screen.findByRole('button', { name: /new task/i }))

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'inventory' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'check apps' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'audit the repo' } })

    const regenButtons = screen.getAllByRole('button', { name: /regenerate with ai/i })
    fireEvent.click(regenButtons[0]!)

    await waitFor(() => {
      expect(runAgentCli).toHaveBeenCalledTimes(1)
      expect(screen.getByLabelText('Title')).toHaveValue('Inventory deployable sites')
    })
  })

  it('uses workspace provider defaults when creating a new task', async () => {
    const createTaskMock = vi.fn(async (input: KanbanCreateTaskInput) =>
      createTask({
        workspaceDir: input.workspaceDir,
        title: input.title,
        prompt: input.prompt,
        description: input.description ?? '',
        provider: input.provider,
        providerConfig: input.providerConfig,
        columnId: input.columnId ?? 'backlog',
        autoStartWhenUnblocked: input.autoStartWhenUnblocked ?? false,
      })
    )
    const { getBoard } = installKanbanWindowMocks({
      settings: {
        defaultProvider: 'codex',
        providerDefaults: {
          codex: {
            model: 'gpt-5.4',
            reasoningEffort: 'high',
          },
        },
      },
    })
    window.orxa.kanban.createTask = createTaskMock

    render(<KanbanBoard />)
    await waitFor(() => {
      expect(getBoard).toHaveBeenCalled()
    })
    fireEvent.click(screen.getByRole('button', { name: /new task/i }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Inventory' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Audit the workspace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'codex',
          providerConfig: {
            codex: {
              model: 'gpt-5.4',
              reasoningEffort: 'high',
            },
          },
        })
      )
    })
  })
})

describe('KanbanBoard rendering', () => {
  it('does not render a ship badge for unshipped tasks', async () => {
    installKanbanWindowMocks({
      tasks: [{ id: 'task-1', title: 'Cross-Site Build Matrix', shipStatus: 'unshipped' }],
    })

    render(<KanbanBoard />)
    fireEvent.click(await screen.findByText('Cross-Site Build Matrix'))

    await waitFor(() => {
      expect(screen.queryByText('PR opened')).not.toBeInTheDocument()
    })
  })
})
