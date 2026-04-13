import type { DesktopPrimaryEnvironmentBootstrap } from '@orxa-code/contracts'

interface CreateLocalEnvironmentBootstrapInput {
  backendAuthToken: string
  backendPort: number
  environmentId: string
}

export function createLocalEnvironmentBootstrap(
  input: CreateLocalEnvironmentBootstrapInput
): DesktopPrimaryEnvironmentBootstrap {
  const httpBaseUrl = `http://127.0.0.1:${input.backendPort}/`
  const wsBaseUrl = `ws://127.0.0.1:${input.backendPort}/`
  return {
    environment: {
      environmentId: input.environmentId,
      label: 'Orxa Code (Desktop)',
      kind: 'local-desktop',
    },
    target: {
      httpBaseUrl,
      wsBaseUrl,
    },
    bootstrapToken: input.backendAuthToken,
  }
}
