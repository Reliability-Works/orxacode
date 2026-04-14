import { PROVIDER_DISPLAY_NAMES } from '@orxa-code/contracts'
import { useNavigate } from '@tanstack/react-router'
import { PanelTopOpenIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import { newCommandId } from '~/lib/utils'
import { readNativeApi } from '~/nativeApi'
import type { Project, Thread } from '../../types'
import { useThreadActions } from '../../hooks/useThreadActions'
import { useUiStateStore } from '../../uiStateStore'
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard'
import { Button } from '../ui/button'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../ui/menu'
import { toastManager } from '../ui/toastState'
import { HandoffDialog } from './HandoffDialog'
import { getHandoffTargetProviders, startThreadHandoff } from './ThreadHandoffMenu.helpers'
import { useIsMobile } from '~/hooks/useMediaQuery'

function showActionError(title: string, error: unknown) {
  toastManager.add({
    type: 'error',
    title,
    description: error instanceof Error ? error.message : 'An unexpected error occurred.',
  })
}

async function renameThread(thread: Thread): Promise<void> {
  const nextTitle = window.prompt('Rename thread', thread.title)
  if (nextTitle === null) {
    return
  }
  const trimmed = nextTitle.trim()
  if (trimmed.length === 0 || trimmed === thread.title) {
    return
  }
  const api = readNativeApi()
  if (!api) {
    return
  }
  await api.orchestration.dispatchCommand({
    type: 'thread.meta.update',
    commandId: newCommandId(),
    threadId: thread.id,
    title: trimmed,
  })
}

function useThreadActionClipboard() {
  const { copyToClipboard: copyWorkingDirectory } = useCopyToClipboard<{ value: string }>({
    onCopy: ctx =>
      toastManager.add({
        type: 'success',
        title: 'Working directory copied',
        description: ctx.value,
      }),
    onError: error => showActionError('Failed to copy working directory', error),
  })
  return { copyWorkingDirectory }
}

function useThreadActionHandoff(thread: Thread, project: Project | null) {
  const navigate = useNavigate()
  const [pendingProvider, setPendingProvider] = useState<
    Thread['modelSelection']['provider'] | null
  >(null)
  const [dialogProvider, setDialogProvider] = useState<Thread['modelSelection']['provider'] | null>(
    null
  )
  const targetProviders = useMemo(
    () => getHandoffTargetProviders(thread.modelSelection.provider),
    [thread.modelSelection.provider]
  )
  const requestHandoff = (targetProvider: Thread['modelSelection']['provider']) => {
    setDialogProvider(targetProvider)
  }
  const cancelHandoff = () => {
    if (pendingProvider === null) {
      setDialogProvider(null)
    }
  }
  const confirmHandoff = async (appendedPrompt: string | null) => {
    if (!dialogProvider) {
      return
    }
    const targetProvider = dialogProvider
    setPendingProvider(targetProvider)
    try {
      await startThreadHandoff({
        navigate,
        thread,
        project,
        targetProvider,
        appendedPrompt,
      })
      setDialogProvider(null)
    } catch (error) {
      showActionError('Failed to hand off thread', error)
    } finally {
      setPendingProvider(null)
    }
  }
  return {
    pendingProvider,
    dialogProvider,
    targetProviders,
    requestHandoff,
    cancelHandoff,
    confirmHandoff,
  }
}

function ThreadActionsMenuItems(props: {
  thread: Thread
  isPinned: boolean
  workingDirectory: string | null
  onPinToggle: () => void
  onArchive: () => void
  copyWorkingDirectory: (value: string, ctx: { value: string }) => void
  pendingProvider: Thread['modelSelection']['provider'] | null
  targetProviders: ReadonlyArray<Thread['modelSelection']['provider']>
  onHandoff: (targetProvider: Thread['modelSelection']['provider']) => void
}) {
  const {
    thread,
    isPinned,
    workingDirectory,
    onPinToggle,
    onArchive,
    copyWorkingDirectory,
    pendingProvider,
    targetProviders,
    onHandoff,
  } = props
  return (
    <>
      <MenuItem onClick={onPinToggle}>{isPinned ? 'Unpin thread' : 'Pin thread'}</MenuItem>
      <MenuItem
        onClick={() => {
          void renameThread(thread).catch(error =>
            showActionError('Failed to rename thread', error)
          )
        }}
      >
        Rename thread
      </MenuItem>
      <MenuItem onClick={onArchive}>Archive thread</MenuItem>
      <MenuSeparator />
      <MenuItem
        disabled={!workingDirectory}
        onClick={() => {
          if (workingDirectory) {
            copyWorkingDirectory(workingDirectory, { value: workingDirectory })
          }
        }}
      >
        Copy working directory
      </MenuItem>
      {targetProviders.length > 0 ? <MenuSeparator /> : null}
      {targetProviders.map(provider => (
        <MenuItem
          key={provider}
          disabled={pendingProvider !== null}
          onClick={() => onHandoff(provider)}
        >
          {pendingProvider === provider
            ? 'Starting...'
            : `Handoff to ${PROVIDER_DISPLAY_NAMES[provider]}`}
        </MenuItem>
      ))}
    </>
  )
}

export function ThreadActionsMenu(props: { thread: Thread; project: Project | null }) {
  const isMobile = useIsMobile()
  const { archiveThread } = useThreadActions()
  const pinnedThreadIds = useUiStateStore(store => store.pinnedThreadIds)
  const pinThread = useUiStateStore(store => store.pinThread)
  const unpinThread = useUiStateStore(store => store.unpinThread)
  const isPinned = pinnedThreadIds.includes(props.thread.id)
  const workingDirectory = props.thread.worktreePath ?? props.project?.cwd ?? null
  const { copyWorkingDirectory } = useThreadActionClipboard()
  const {
    pendingProvider,
    dialogProvider,
    targetProviders,
    requestHandoff,
    cancelHandoff,
    confirmHandoff,
  } = useThreadActionHandoff(props.thread, props.project)

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              size={isMobile ? 'icon-sm' : 'icon-xs'}
              variant="ghost"
              className="shrink-0 translate-y-px gap-0 [&_svg]:mx-0"
              aria-label="Thread actions"
            />
          }
        >
          <PanelTopOpenIcon className={isMobile ? 'size-4' : 'size-3.5'} />
        </MenuTrigger>
        <MenuPopup align="start" className="min-w-56">
          <ThreadActionsMenuItems
            thread={props.thread}
            isPinned={isPinned}
            workingDirectory={workingDirectory}
            onPinToggle={() =>
              isPinned ? unpinThread(props.thread.id) : pinThread(props.thread.id)
            }
            onArchive={() => {
              void archiveThread(props.thread.id).catch(error =>
                showActionError('Failed to archive thread', error)
              )
            }}
            copyWorkingDirectory={copyWorkingDirectory}
            pendingProvider={pendingProvider}
            targetProviders={targetProviders}
            onHandoff={targetProvider => {
              requestHandoff(targetProvider)
            }}
          />
        </MenuPopup>
      </Menu>
      <HandoffDialog
        open={dialogProvider !== null}
        targetProvider={dialogProvider}
        isSubmitting={pendingProvider !== null}
        onCancel={cancelHandoff}
        onConfirm={appendedPrompt => void confirmHandoff(appendedPrompt)}
      />
    </>
  )
}
