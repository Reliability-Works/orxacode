import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { installAppTestEnvironment } from './App.test.shared'

type MinimalProjectData = {
  directory: string
  path: object
  sessions: Array<{
    id: string
    slug: string
    title: string
    time: { created: number; updated: number }
  }>
  sessionStatus: Record<string, { type: 'idle' }>
  providers: { all: never[]; connected: never[]; default: object }
  agents: never[]
  config: object
  permissions: never[]
  questions: never[]
  commands: never[]
  mcp: object
  lsp: never[]
  formatter: never[]
  ptys: never[]
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  installAppTestEnvironment()
})

it('keeps the startup overlay up until background workspace session preloads finish', async () => {
  const delayedWorkspace = deferred<MinimalProjectData>()
  const now = Date.now()
  const bootstrapMock = vi.fn(async () => ({
    projects: [
      {
        id: 'proj-1',
        name: 'forjex-mobile',
        worktree: '/repo/forjex-mobile',
        source: 'local' as const,
      },
      {
        id: 'proj-2',
        name: 'marketing-websites',
        worktree: '/repo/marketing-websites',
        source: 'local' as const,
      },
    ],
    runtime: { status: 'disconnected' as const, managedServer: false },
  }))
  const selectProjectMock = vi.fn(async (directory: string) => {
    if (directory === '/repo/forjex-mobile') {
      return {
        directory,
        path: {},
        sessions: [],
        sessionStatus: {},
        providers: { all: [], connected: [], default: {} },
        agents: [],
        config: {},
        permissions: [],
        questions: [],
        commands: [],
        mcp: {},
        lsp: [],
        formatter: [],
        ptys: [],
      }
    }
    if (directory === '/repo/marketing-websites') {
      return delayedWorkspace.promise
    }
    throw new Error(`Unexpected directory ${directory}`)
  })

  Object.defineProperty(window, 'orxa', {
    value: {
      ...window.orxa,
      opencode: {
        ...window.orxa!.opencode,
        bootstrap: bootstrapMock,
        selectProject: selectProjectMock,
      },
    },
    configurable: true,
  })

  render(<App />)

  await waitFor(() => {
    expect(screen.getByText('Initializing Orxa Code')).toBeInTheDocument()
    expect(screen.getByText('Bootstrapping workspaces…')).toBeInTheDocument()
  })

  delayedWorkspace.resolve({
    directory: '/repo/marketing-websites',
    path: {},
    sessions: [
      {
        id: 'session-1',
        slug: 'handle-greeting-request',
        title: 'Handle Greeting Request',
        time: { created: now, updated: now },
      },
    ],
    sessionStatus: { 'session-1': { type: 'idle' } },
    providers: { all: [], connected: [], default: {} },
    agents: [],
    config: {},
    permissions: [],
    questions: [],
    commands: [],
    mcp: {},
    lsp: [],
    formatter: [],
    ptys: [],
  })

  expect(await screen.findByText('Handle Greeting Request')).toBeInTheDocument()
  await waitFor(() => {
    expect(screen.queryByText('Bootstrapping workspaces…')).toBeNull()
  })
})
