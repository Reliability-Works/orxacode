import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from '@orxa-code/contracts'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRightLeftIcon, ChevronDownIcon } from 'lucide-react'
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
import {
  buildWorktreeHandoffContext,
  getHandoffTargetProviders,
  startThreadHandoff,
} from './ThreadHandoffMenu.helpers'

export function ThreadHandoffMenu(props: {
  thread: Thread
  project: Project | null
  onOpenPullRequestDialog?: (reference?: string, bootstrapPrompt?: string | null) => void
}) {
  const navigate = useNavigate()
  const [pendingProvider, setPendingProvider] = useState<ProviderKind | null>(null)

  const targetProviders = useMemo(
    () => getHandoffTargetProviders(props.thread.modelSelection.provider),
    [props.thread.modelSelection.provider]
  )

  if (targetProviders.length === 0) {
    return null
  }

  async function handoffToProvider(targetProvider: ProviderKind) {
    setPendingProvider(targetProvider)

    try {
      await startThreadHandoff({
        navigate,
        thread: props.thread,
        project: props.project,
        targetProvider,
      })
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

  function handoffToPullRequestThread() {
    props.onOpenPullRequestDialog?.(undefined, buildWorktreeHandoffContext(props.thread))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="xs" variant="outline" disabled={pendingProvider !== null} />}
      >
        <span className="inline-flex items-center gap-1.5">
          <ArrowRightLeftIcon className="size-3.5" />
          <span>Handoff</span>
          <ChevronDownIcon className="size-3.5" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {targetProviders.map(provider => (
          <DropdownMenuItem key={provider} onClick={() => void handoffToProvider(provider)}>
            {pendingProvider === provider ? 'Starting...' : PROVIDER_DISPLAY_NAMES[provider]}
          </DropdownMenuItem>
        ))}
        {props.onOpenPullRequestDialog ? (
          <DropdownMenuItem onClick={handoffToPullRequestThread}>
            Fork / Worktree Thread...
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
