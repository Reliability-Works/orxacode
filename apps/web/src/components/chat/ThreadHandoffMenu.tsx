import {
  PROVIDER_DISPLAY_NAMES,
  type ModelSelection,
  type ProviderKind,
} from '@orxa-code/contracts'
import { useNavigate } from '@tanstack/react-router'
import { HandshakeIcon, ChevronDownIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { Project, Thread } from '../../types'
import { toastManager } from '../ui/toastState'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/menu'
import { HandoffDialog, type HandoffProviderModelOption } from './HandoffDialog'
import {
  buildWorktreeHandoffContext,
  getHandoffTargetProviders,
  startThreadHandoff,
} from './ThreadHandoffMenu.helpers'

function HandoffDropdown(props: {
  targetProviders: ReadonlyArray<ProviderKind>
  pendingProvider: ProviderKind | null
  onSelectProvider: (provider: ProviderKind) => void
  onSelectPullRequest: (() => void) | null
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="xs" variant="outline" disabled={props.pendingProvider !== null} />}
      >
        <span className="inline-flex items-center gap-1.5">
          <HandshakeIcon className="size-3.5" />
          <span>Handoff</span>
          <ChevronDownIcon className="size-3.5" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {props.targetProviders.map(provider => (
          <DropdownMenuItem key={provider} onClick={() => props.onSelectProvider(provider)}>
            {props.pendingProvider === provider ? 'Starting...' : PROVIDER_DISPLAY_NAMES[provider]}
          </DropdownMenuItem>
        ))}
        {props.onSelectPullRequest ? (
          <DropdownMenuItem onClick={props.onSelectPullRequest}>
            Fork / Worktree Thread...
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ThreadHandoffMenu(props: {
  thread: Thread
  project: Project | null
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<HandoffProviderModelOption>>
  onOpenPullRequestDialog?: (reference?: string, bootstrapPrompt?: string | null) => void
}) {
  const navigate = useNavigate()
  const [pendingProvider, setPendingProvider] = useState<ProviderKind | null>(null)
  const [dialogProvider, setDialogProvider] = useState<ProviderKind | null>(null)

  const targetProviders = useMemo(
    () => getHandoffTargetProviders(props.thread.modelSelection.provider),
    [props.thread.modelSelection.provider]
  )

  if (targetProviders.length === 0) {
    return null
  }

  async function confirmHandoff(args: {
    appendedPrompt: string | null
    modelSelection: ModelSelection
  }) {
    if (!dialogProvider) {
      return
    }
    const targetProvider = dialogProvider
    setPendingProvider(targetProvider)
    try {
      await startThreadHandoff({
        navigate,
        thread: props.thread,
        project: props.project,
        targetProvider,
        appendedPrompt: args.appendedPrompt,
        modelSelection: args.modelSelection,
      })
      setDialogProvider(null)
    } catch (error) {
      toastManager.add({
        type: 'error',
        title: 'Failed to hand off thread',
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
      })
    } finally {
      setPendingProvider(null)
    }
  }

  const onOpenPullRequestDialog = props.onOpenPullRequestDialog
  const onSelectPullRequest = onOpenPullRequestDialog
    ? () => onOpenPullRequestDialog(undefined, buildWorktreeHandoffContext(props.thread))
    : null

  return (
    <>
      <HandoffDropdown
        targetProviders={targetProviders}
        pendingProvider={pendingProvider}
        onSelectProvider={setDialogProvider}
        onSelectPullRequest={onSelectPullRequest}
      />
      <HandoffDialog
        open={dialogProvider !== null}
        targetProvider={dialogProvider}
        isSubmitting={pendingProvider !== null}
        modelOptionsByProvider={props.modelOptionsByProvider}
        projectDefaultModelSelection={props.project?.defaultModelSelection ?? null}
        onCancel={() => setDialogProvider(null)}
        onConfirm={args => void confirmHandoff(args)}
      />
    </>
  )
}
