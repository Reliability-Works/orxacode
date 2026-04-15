/**
 * Registry of topbar buttons eligible for the zen-mode allowlist.
 *
 * The session title and the Unzen button are intentionally excluded — they're
 * always visible in zen. Everything else the user might want to keep in zen
 * must have a stable `id` here so settings can persist an allowlist.
 */

export const TOPBAR_BUTTON_IDS = [
  'app.sidebarTrigger',
  'chat.views',
  'chat.openIn',
  'chat.gitActions',
  'chat.handoff',
  'chat.threadActions',
  'chat.gitSidebarToggle',
] as const

export type TopbarButtonId = (typeof TOPBAR_BUTTON_IDS)[number]

export const TOPBAR_BUTTONS: ReadonlyArray<{
  id: TopbarButtonId
  label: string
  description: string
}> = [
  {
    id: 'app.sidebarTrigger',
    label: 'Main sidebar toggle',
    description: 'Button that opens or closes the main app sidebar.',
  },
  {
    id: 'chat.views',
    label: 'Views menu',
    description: 'Split pane, files, browser, and terminal toggles.',
  },
  {
    id: 'chat.openIn',
    label: 'Open in editor',
    description: 'Open the current project in an external editor.',
  },
  {
    id: 'chat.gitActions',
    label: 'Git actions',
    description: 'Commit, push, and branch controls.',
  },
  {
    id: 'chat.handoff',
    label: 'Handoff',
    description: 'Hand off the thread to another provider.',
  },
  {
    id: 'chat.threadActions',
    label: 'Thread actions menu',
    description: 'Rename, archive, and delete the current thread.',
  },
  {
    id: 'chat.gitSidebarToggle',
    label: 'Git sidebar toggle',
    description: 'Show or hide the git diff sidebar.',
  },
]

export function isTopbarButtonId(value: string): value is TopbarButtonId {
  return (TOPBAR_BUTTON_IDS as readonly string[]).includes(value)
}
