// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  useEventRouterWelcomeHandler,
} from './-__root.eventRouter'
import { AppAtomRegistryProvider } from '../rpc/atomRegistry'
import {
  emitWelcome,
  resetServerStateForTests,
  useServerWelcomeSubscription,
} from '../rpc/serverState'

function WelcomeReplayProbe(props: {
  readonly callLog: string[]
}) {
  const disposedRef = useRef(false)
  const handledBootstrapThreadIdRef = useRef<string | null>(null)
  const pathnameRef = useRef('/')
  const bootstrapFromSnapshotRef = useRef<() => Promise<void>>(async () => {
    props.callLog.push('default')
  })

  useEffect(() => {
    bootstrapFromSnapshotRef.current = async () => {
      props.callLog.push('runtime')
    }
  }, [props.callLog])

  const handleWelcome = useEventRouterWelcomeHandler({
    connectionId: 41,
    bootstrapFromSnapshotRef,
    disposedRef,
    handledBootstrapThreadIdRef,
    navigateToThread: async () => undefined,
    pathnameRef,
    runtimeGeneration: 7,
    setProjectExpanded: () => undefined,
  })

  useServerWelcomeSubscription(handleWelcome)

  return null
}

describe('root event router welcome bootstrap ordering', () => {
  afterEach(() => {
    resetServerStateForTests()
  })

  it('runs the installed runtime bootstrap when a welcome event is replayed on mount', async () => {
    const callLog: string[] = []

    emitWelcome({
      cwd: '/tmp/workspace',
      projectName: 'orxa-code',
    })

    render(
      <AppAtomRegistryProvider>
        <WelcomeReplayProbe callLog={callLog} />
      </AppAtomRegistryProvider>
    )

    await waitFor(() => {
      expect(callLog).toEqual(['runtime'])
    })
  })
})
