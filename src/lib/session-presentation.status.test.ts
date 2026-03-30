import { expect, it } from 'vitest'
import { buildComposerPresentation, buildSidebarSessionPresentation } from './session-presentation'

it('derives shared sidebar and composer presentation state', () => {
  const sidebar = buildSidebarSessionPresentation({
    sessionKey: 'codex::/repo::thr-1',
    status: {
      type: 'busy',
      busy: true,
      awaiting: false,
      unread: true,
      planReady: false,
      activityAt: 10,
    },
    updatedAt: 12,
    isActive: false,
  })
  const composer = buildComposerPresentation({
    status: {
      type: 'awaiting',
      busy: false,
      awaiting: true,
      unread: false,
      planReady: false,
      activityAt: 12,
    },
    sending: false,
    pending: {
      kind: 'permission',
      provider: 'codex',
      awaiting: true,
      label: 'Agent needs permission',
    },
  })

  expect(sidebar.indicator).toBe('busy')
  expect(composer).toMatchObject({
    busy: false,
    awaiting: true,
    blockedBy: 'permission',
  })
})

it('suppresses active-session sidebar indicators', () => {
  const sidebar = buildSidebarSessionPresentation({
    sessionKey: 'codex::/repo::thr-1',
    status: {
      type: 'plan_ready',
      busy: false,
      awaiting: false,
      unread: true,
      planReady: true,
      activityAt: 10,
    },
    updatedAt: 12,
    isActive: true,
  })

  expect(sidebar).toMatchObject({
    indicator: 'none',
    unread: false,
  })
})
