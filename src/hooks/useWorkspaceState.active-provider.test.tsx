import { act } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import {
  renderWorkspaceStateHook,
  resetWorkspaceStateForTests,
} from './useWorkspaceState.test-helpers'

beforeEach(() => {
  resetWorkspaceStateForTests()
})

it('does not force selected sessions onto the OpenCode provider', async () => {
  const { result } = renderWorkspaceStateHook()

  await act(async () => {
    result.current.setActiveProjectDir('/repo/orxacode')
    result.current.setActiveSessionID('session-codex')
  })

  expect(useUnifiedRuntimeStore.getState().activeSessionID).toBe('session-codex')
  expect(useUnifiedRuntimeStore.getState().activeProvider).toBeUndefined()
})
