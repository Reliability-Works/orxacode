/**
 * Shared factory for building Thread fixtures across web test helpers.
 *
 * Different suites expect different defaults (model, timestamps), so this
 * exposes a small factory that produces a `makeThread(overrides)` function
 * specialized to the suite's defaults.
 */

import { ProjectId, ThreadId } from '@orxa-code/contracts'
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from '../types'

export interface MakeThreadDefaults {
  model: string
  createdAt: string
  includeUpdatedAt?: boolean
}

export function createMakeThread(defaults: MakeThreadDefaults) {
  return function makeThread(overrides: Partial<Thread> = {}): Thread {
    return {
      id: ThreadId.makeUnsafe('thread-1'),
      codexThreadId: null,
      projectId: ProjectId.makeUnsafe('project-1'),
      title: 'Thread',
      modelSelection: {
        provider: 'codex',
        model: defaults.model,
        ...overrides?.modelSelection,
      },
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_INTERACTION_MODE,
      session: null,
      messages: [],
      turnDiffSummaries: [],
      activities: [],
      proposedPlans: [],
      error: null,
      createdAt: defaults.createdAt,
      archivedAt: null,
      ...(defaults.includeUpdatedAt ? { updatedAt: defaults.createdAt } : {}),
      latestTurn: null,
      branch: null,
      worktreePath: null,
      parentBranch: null,
      gitRoot: null,
      handoff: null,
      parentLink: null,
      ...overrides,
    }
  }
}
