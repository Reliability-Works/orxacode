import {
  EventId,
  type MessageId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type ProjectId,
  type ServerConfig,
  type ThreadId,
  type TurnId,
  OrchestrationSessionStatus,
  DEFAULT_SERVER_SETTINGS,
} from '@orxa-code/contracts'
import { type TerminalContextDraft } from '../lib/terminalContext'
import { DEFAULT_CLIENT_SETTINGS } from '@orxa-code/contracts/settings'
import { useComposerDraftStore } from '../composerDraftStore'

export const BROWSER_TEST_THREAD_ID = 'thread-browser-test' as ThreadId
export const BROWSER_TEST_PROJECT_ID = 'project-1' as ProjectId
export const BROWSER_TEST_NOW_ISO = '2026-03-04T12:00:00.000Z'
export const BROWSER_TEST_BASE_TIME_MS = Date.parse(BROWSER_TEST_NOW_ISO)

export function isoAt(offsetSeconds: number): string {
  return new Date(BROWSER_TEST_BASE_TIME_MS + offsetSeconds * 1_000).toISOString()
}

export function createBaseServerConfig(): ServerConfig {
  return {
    cwd: '/repo/project',
    keybindingsConfigPath: '/repo/project/.orxa-keybindings.json',
    keybindings: [],
    issues: [],
    providers: [
      {
        provider: 'codex',
        enabled: true,
        installed: true,
        version: '0.116.0',
        status: 'ready',
        auth: { status: 'authenticated' },
        checkedAt: BROWSER_TEST_NOW_ISO,
        models: [],
      },
    ],
    availableEditors: [],
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      ...DEFAULT_CLIENT_SETTINGS,
    },
  }
}

export function createUserMessage(options: {
  id: MessageId
  text: string
  offsetSeconds: number
  attachments?: Array<{
    type: 'image'
    id: string
    name: string
    mimeType: string
    sizeBytes: number
  }>
}) {
  return {
    id: options.id,
    role: 'user' as const,
    text: options.text,
    ...(options.attachments ? { attachments: options.attachments } : {}),
    turnId: null,
    streaming: false,
    createdAt: isoAt(options.offsetSeconds),
    updatedAt: isoAt(options.offsetSeconds + 1),
  }
}

export function createAssistantMessage(options: {
  id: MessageId
  text: string
  offsetSeconds: number
}) {
  return {
    id: options.id,
    role: 'assistant' as const,
    text: options.text,
    turnId: null,
    streaming: false,
    createdAt: isoAt(options.offsetSeconds),
    updatedAt: isoAt(options.offsetSeconds + 1),
  }
}

export function createTerminalContext(input: {
  id: string
  terminalLabel: string
  lineStart: number
  lineEnd: number
  text: string
}): TerminalContextDraft {
  return {
    id: input.id,
    threadId: BROWSER_TEST_THREAD_ID,
    terminalId: `terminal-${input.id}`,
    terminalLabel: input.terminalLabel,
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    text: input.text,
    createdAt: BROWSER_TEST_NOW_ISO,
  }
}

function buildSnapshotMessages(options: {
  targetMessageId: MessageId
  targetText: string
  targetAttachmentCount?: number
  sessionStatus?: OrchestrationSessionStatus
}): OrchestrationReadModel['threads'][number]['messages'] {
  const messages: Array<
    ReturnType<typeof createUserMessage> | ReturnType<typeof createAssistantMessage>
  > = []
  for (let index = 0; index < 22; index += 1) {
    const isTarget = index === 3
    const userId = `msg-user-${index}` as MessageId
    const assistantId = `msg-assistant-${index}` as MessageId
    const attachments =
      isTarget && (options.targetAttachmentCount ?? 0) > 0
        ? Array.from({ length: options.targetAttachmentCount ?? 0 }, (_, ai) => ({
            type: 'image' as const,
            id: `attachment-${ai + 1}`,
            name: `attachment-${ai + 1}.png`,
            mimeType: 'image/png',
            sizeBytes: 128,
          }))
        : undefined
    messages.push(
      createUserMessage({
        id: isTarget ? options.targetMessageId : userId,
        text: isTarget ? options.targetText : `filler user message ${index}`,
        offsetSeconds: messages.length * 3,
        ...(attachments ? { attachments } : {}),
      })
    )
    messages.push(
      createAssistantMessage({
        id: assistantId,
        text: `assistant filler ${index}`,
        offsetSeconds: messages.length * 3,
      })
    )
  }
  return messages
}

export function createSnapshotForTargetUser(options: {
  targetMessageId: MessageId
  targetText: string
  targetAttachmentCount?: number
  sessionStatus?: OrchestrationSessionStatus
}): OrchestrationReadModel {
  const messages = buildSnapshotMessages(options)
  return {
    snapshotSequence: 1,
    projects: [
      {
        id: BROWSER_TEST_PROJECT_ID,
        title: 'Project',
        workspaceRoot: '/repo/project',
        defaultModelSelection: { provider: 'codex', model: 'gpt-5' },
        scripts: [],
        createdAt: BROWSER_TEST_NOW_ISO,
        updatedAt: BROWSER_TEST_NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      buildTestThread(
        BROWSER_TEST_THREAD_ID,
        'Browser test thread',
        messages,
        options.sessionStatus ?? 'ready'
      ),
    ],
    updatedAt: BROWSER_TEST_NOW_ISO,
  }
}

export interface TestFixture {
  snapshot: OrchestrationReadModel
  serverConfig: ServerConfig
  welcome: import('@orxa-code/contracts').ServerLifecycleWelcomePayload
}

function buildTestThread(
  threadId: ThreadId,
  title: string,
  messages: OrchestrationReadModel['threads'][number]['messages'],
  sessionStatus: OrchestrationSessionStatus = 'ready'
): OrchestrationReadModel['threads'][number] {
  return {
    id: threadId,
    projectId: BROWSER_TEST_PROJECT_ID,
    title,
    modelSelection: { provider: 'codex', model: 'gpt-5' },
    interactionMode: 'default',
    runtimeMode: 'full-access',
    branch: 'main',
    worktreePath: null,
    handoff: null,
    parentLink: null,
    latestTurn: null,
    createdAt: BROWSER_TEST_NOW_ISO,
    updatedAt: BROWSER_TEST_NOW_ISO,
    archivedAt: null,
    deletedAt: null,
    messages,
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: {
      threadId,
      status: sessionStatus,
      providerName: 'codex',
      providerSessionId: null,
      providerThreadId: 'codex-thread-1',
      runtimeMode: 'full-access',
      activeTurnId: null,
      lastError: null,
      updatedAt: BROWSER_TEST_NOW_ISO,
    },
  }
}

export function buildFixture(snapshot: OrchestrationReadModel): TestFixture {
  return {
    snapshot,
    serverConfig: createBaseServerConfig(),
    welcome: {
      cwd: '/repo/project',
      projectName: 'Project',
      bootstrapProjectId: BROWSER_TEST_PROJECT_ID,
      bootstrapThreadId: BROWSER_TEST_THREAD_ID,
    },
  }
}

export function addThreadToSnapshot(
  snapshot: OrchestrationReadModel,
  threadId: ThreadId
): OrchestrationReadModel {
  return {
    ...snapshot,
    snapshotSequence: snapshot.snapshotSequence + 1,
    threads: [...snapshot.threads, buildTestThread(threadId, 'New thread', [])],
  }
}

export function createThreadCreatedEvent(threadId: ThreadId, sequence: number): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.makeUnsafe(`event-thread-created-${sequence}`),
    aggregateKind: 'thread',
    aggregateId: threadId,
    occurredAt: BROWSER_TEST_NOW_ISO,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: 'thread.created',
    payload: {
      threadId,
      projectId: BROWSER_TEST_PROJECT_ID,
      title: 'New thread',
      modelSelection: { provider: 'codex', model: 'gpt-5' },
      runtimeMode: 'full-access',
      interactionMode: 'default',
      branch: 'main',
      worktreePath: null,
      createdAt: BROWSER_TEST_NOW_ISO,
      updatedAt: BROWSER_TEST_NOW_ISO,
    },
  }
}

export function createDraftOnlySnapshot(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: 'msg-user-draft-target' as MessageId,
    targetText: 'draft thread',
  })
  return { ...snapshot, threads: [] }
}

export function withProjectScripts(
  snapshot: OrchestrationReadModel,
  scripts: OrchestrationReadModel['projects'][number]['scripts']
): OrchestrationReadModel {
  return {
    ...snapshot,
    projects: snapshot.projects.map(project =>
      project.id === BROWSER_TEST_PROJECT_ID
        ? { ...project, scripts: Array.from(scripts) }
        : project
    ),
  }
}

export function setDraftThreadWithoutWorktree(): void {
  useComposerDraftStore.setState({
    draftThreadsByThreadId: {
      [BROWSER_TEST_THREAD_ID]: {
        projectId: BROWSER_TEST_PROJECT_ID,
        createdAt: BROWSER_TEST_NOW_ISO,
        runtimeMode: 'full-access',
        interactionMode: 'default',
        branch: null,
        worktreePath: null,
        envMode: 'local',
      },
    },
    projectDraftThreadIdByProjectId: {
      [BROWSER_TEST_PROJECT_ID]: BROWSER_TEST_THREAD_ID,
    },
  })
}

export function createSnapshotWithLongProposedPlan(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: 'msg-user-plan-target' as MessageId,
    targetText: 'plan thread',
  })
  const planMarkdown = [
    '# Ship plan mode follow-up',
    '',
    '- Step 1: capture the thread-open trace',
    '- Step 2: identify the main-thread bottleneck',
    '- Step 3: keep collapsed cards cheap',
    '- Step 4: render the full markdown only on demand',
    '- Step 5: preserve export and save actions',
    '- Step 6: add regression coverage',
    '- Step 7: verify route transitions stay responsive',
    '- Step 8: confirm no server-side work changed',
    '- Step 9: confirm short plans still render normally',
    '- Step 10: confirm long plans stay collapsed by default',
    '- Step 11: confirm preview text is still useful',
    '- Step 12: confirm plan follow-up flow still works',
    '- Step 13: confirm timeline virtualization still behaves',
    '- Step 14: confirm theme styling still looks correct',
    '- Step 15: confirm save dialog behavior is unchanged',
    '- Step 16: confirm download behavior is unchanged',
    '- Step 17: confirm code fences do not parse until expand',
    '- Step 18: confirm preview truncation ends cleanly',
    '- Step 19: confirm markdown links still open in editor after expand',
    '- Step 20: confirm deep hidden detail only appears after expand',
    '',
    '```ts',
    "export const hiddenPlanImplementationDetail = 'deep hidden detail only after expand';",
    '```',
  ].join('\n')
  return {
    ...snapshot,
    threads: snapshot.threads.map(thread =>
      thread.id === BROWSER_TEST_THREAD_ID
        ? Object.assign({}, thread, {
            proposedPlans: [
              {
                id: 'plan-browser-test',
                turnId: null,
                planMarkdown,
                implementedAt: null,
                implementationThreadId: null,
                createdAt: isoAt(1_000),
                updatedAt: isoAt(1_001),
              },
            ],
            updatedAt: isoAt(1_001),
          })
        : thread
    ),
  }
}

export function createSnapshotWithPendingUserInput(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: 'msg-user-pending-input-target' as MessageId,
    targetText: 'question thread',
  })
  return {
    ...snapshot,
    threads: snapshot.threads.map(thread =>
      thread.id === BROWSER_TEST_THREAD_ID
        ? Object.assign({}, thread, {
            interactionMode: 'plan',
            activities: [
              {
                id: EventId.makeUnsafe('activity-user-input-requested'),
                tone: 'info',
                kind: 'user-input.requested',
                summary: 'User input requested',
                payload: {
                  requestId: 'req-browser-user-input',
                  questions: [
                    {
                      id: 'scope',
                      header: 'Scope',
                      question: 'What should this change cover?',
                      options: [
                        { label: 'Tight', description: 'Touch only the footer layout logic.' },
                        {
                          label: 'Broad',
                          description: 'Also adjust the related composer controls.',
                        },
                      ],
                    },
                    {
                      id: 'risk',
                      header: 'Risk',
                      question: 'How aggressive should the imaginary plan be?',
                      options: [
                        {
                          label: 'Conservative',
                          description: 'Favor reliability and low-risk changes.',
                        },
                        {
                          label: 'Balanced',
                          description: 'Mix quick wins with one structural improvement.',
                        },
                      ],
                    },
                  ],
                },
                turnId: null,
                sequence: 1,
                createdAt: isoAt(1_000),
              },
            ],
            updatedAt: isoAt(1_000),
          })
        : thread
    ),
  }
}

export function createSnapshotWithPlanFollowUpPrompt(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: 'msg-user-plan-follow-up-target' as MessageId,
    targetText: 'plan follow-up thread',
  })
  return {
    ...snapshot,
    threads: snapshot.threads.map(thread =>
      thread.id === BROWSER_TEST_THREAD_ID
        ? Object.assign({}, thread, {
            interactionMode: 'plan',
            latestTurn: {
              turnId: 'turn-plan-follow-up' as TurnId,
              state: 'completed',
              requestedAt: isoAt(1_000),
              startedAt: isoAt(1_001),
              completedAt: isoAt(1_010),
              assistantMessageId: null,
            },
            proposedPlans: [
              {
                id: 'plan-follow-up-browser-test',
                turnId: 'turn-plan-follow-up' as TurnId,
                planMarkdown: '# Follow-up plan\n\n- Keep the composer footer stable on resize.',
                implementedAt: null,
                implementationThreadId: null,
                createdAt: isoAt(1_002),
                updatedAt: isoAt(1_003),
              },
            ],
            session: { ...thread.session, status: 'ready', updatedAt: isoAt(1_010) },
            updatedAt: isoAt(1_010),
          })
        : thread
    ),
  }
}
