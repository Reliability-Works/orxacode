import type { ExecutionEnvironmentDescriptor } from '@orxa-code/contracts'
import { create } from 'zustand'

import { readPrimaryEnvironmentTarget, resolvePrimaryEnvironmentTarget } from './target'

const SERVER_ENVIRONMENT_DESCRIPTOR_PATH = '/.well-known/orxa/environment'

export class PrimaryEnvironmentUnavailableError extends Error {
  constructor(message = 'Primary environment is not available on this origin.') {
    super(message)
    this.name = 'PrimaryEnvironmentUnavailableError'
  }
}

interface PrimaryEnvironmentBootstrapState {
  readonly descriptor: ExecutionEnvironmentDescriptor | null
  readonly setDescriptor: (descriptor: ExecutionEnvironmentDescriptor | null) => void
  readonly reset: () => void
}

const usePrimaryEnvironmentBootstrapStore = create<PrimaryEnvironmentBootstrapState>()(set => ({
  descriptor: null,
  setDescriptor: descriptor => set({ descriptor }),
  reset: () => set({ descriptor: null }),
}))

let primaryEnvironmentDescriptorPromise: Promise<ExecutionEnvironmentDescriptor> | null = null

function isPrimaryEnvironmentAvailabilityError(error: unknown): boolean {
  return (
    error instanceof PrimaryEnvironmentUnavailableError ||
    (error instanceof Error &&
      (error.message === 'Failed to fetch' || error.name === 'TypeError'))
  )
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('application/json')
}

async function readUnavailablePrimaryEnvironmentResponse(
  response: Response,
  targetSource: ReturnType<typeof readPrimaryEnvironmentTarget>['source']
): Promise<never> {
  const text = await response.text()
  const isHtml = /^\s*</.test(text)
  if (targetSource === 'window-origin' && isHtml) {
    throw new PrimaryEnvironmentUnavailableError()
  }
  throw new Error(`Failed to load server environment descriptor (${response.status}).`)
}

async function fetchPrimaryEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
  const primaryTarget = await resolvePrimaryEnvironmentTarget()
  const url = new URL(primaryTarget.target.httpBaseUrl)
  url.pathname = SERVER_ENVIRONMENT_DESCRIPTOR_PATH
  url.search = ''
  url.hash = ''
  let response: Response
  try {
    response = await fetch(url.toString())
  } catch (error) {
    if (primaryTarget.source === 'window-origin') {
      throw new PrimaryEnvironmentUnavailableError()
    }
    throw error
  }
  if (!response.ok) {
    throw new Error(`Failed to load server environment descriptor (${response.status}).`)
  }
  if (!isJsonResponse(response)) {
    return readUnavailablePrimaryEnvironmentResponse(response, primaryTarget.source)
  }
  const descriptor = (await response.json()) as ExecutionEnvironmentDescriptor
  writePrimaryEnvironmentDescriptor(descriptor)
  return descriptor
}

export function readPrimaryEnvironmentDescriptor(): ExecutionEnvironmentDescriptor | null {
  return usePrimaryEnvironmentBootstrapStore.getState().descriptor
}

export function writePrimaryEnvironmentDescriptor(
  descriptor: ExecutionEnvironmentDescriptor | null
): void {
  usePrimaryEnvironmentBootstrapStore.getState().setDescriptor(descriptor)
}

export function getPrimaryKnownEnvironment() {
  const descriptor = readPrimaryEnvironmentDescriptor()
  if (!descriptor) {
    return null
  }

  const primaryTarget = readPrimaryEnvironmentTarget()
  return {
    id: descriptor.environmentId,
    label: descriptor.label,
    source: primaryTarget.source,
    environmentId: descriptor.environmentId,
    target: primaryTarget.target,
  } as const
}

export function resolveInitialPrimaryEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
  const descriptor = readPrimaryEnvironmentDescriptor()
  if (descriptor) {
    return Promise.resolve(descriptor)
  }

  if (primaryEnvironmentDescriptorPromise) {
    return primaryEnvironmentDescriptorPromise
  }

  const nextPromise = fetchPrimaryEnvironmentDescriptor()
  primaryEnvironmentDescriptorPromise = nextPromise.finally(() => {
    if (primaryEnvironmentDescriptorPromise === nextPromise) {
      primaryEnvironmentDescriptorPromise = null
    }
  })
  return primaryEnvironmentDescriptorPromise
}

export async function tryResolveInitialPrimaryEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor | null> {
  try {
    return await resolveInitialPrimaryEnvironmentDescriptor()
  } catch (error) {
    if (isPrimaryEnvironmentAvailabilityError(error)) {
      return null
    }
    throw error
  }
}

export function resetPrimaryEnvironmentDescriptorForTests(): void {
  primaryEnvironmentDescriptorPromise = null
  usePrimaryEnvironmentBootstrapStore.getState().reset()
}
