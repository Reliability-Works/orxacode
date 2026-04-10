import type * as React from 'react'
import { useCallback, useState } from 'react'
import type { ProjectId, ProviderKind, ServerProvider, ThreadId } from '@orxa-code/contracts'
import { DEFAULT_MODEL_BY_PROVIDER } from '@orxa-code/contracts'
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '~/components/ui/dialog'
import { useSidebar } from '~/components/ui/sidebar.shared'
import { useServerProviders } from '~/rpc/serverState'
import { useHandleNewThread } from '~/hooks/useHandleNewThread'
import { resolveNewSessionProjectId } from './NewSessionModal.logic'
import { NewSessionModalProviderStep } from './NewSessionModal.providerStep'
import { useNewSessionCreate } from './useNewSessionCreate'

interface NewSessionModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly projectId?: ProjectId | null
  readonly onCreated?: (threadId: ThreadId) => Promise<void> | void
}

function resolveDefaultModel(
  provider: ProviderKind,
  liveProvider: ServerProvider | undefined
): string {
  const firstModel = liveProvider?.models[0]?.slug
  return firstModel ?? DEFAULT_MODEL_BY_PROVIDER[provider]
}

async function finalizeSessionCreation(params: {
  threadId: ThreadId
  onCreated: ((threadId: ThreadId) => Promise<void> | void) | undefined
  onClose: () => void
  isSidebarMobile: boolean
  setOpenMobile: (open: boolean) => void
}) {
  if (params.onCreated) {
    await params.onCreated(params.threadId)
  }
  params.onClose()
  if (params.isSidebarMobile) {
    params.setOpenMobile(false)
  }
}

function handleNewSessionOpenChange(
  nextOpen: boolean,
  resetState: () => void,
  onClose: () => void
): void {
  if (!nextOpen) {
    resetState()
    onClose()
  }
}

function useNewSessionSelection(params: {
  create: ReturnType<typeof useNewSessionCreate>['create']
  liveProviders: ReturnType<typeof useServerProviders>
  targetProjectId: ProjectId | null
  onCreated: NewSessionModalProps['onCreated']
  onClose: () => void
  isSidebarMobile: boolean
  setOpenMobile: (open: boolean) => void
  setCreateError: React.Dispatch<React.SetStateAction<string | null>>
  setPendingProvider: React.Dispatch<React.SetStateAction<ProviderKind | null>>
}) {
  return useCallback(
    async (provider: ProviderKind): Promise<void> => {
      params.setCreateError(null)
      params.setPendingProvider(provider)
      try {
        const liveProvider = params.liveProviders.find(p => p.provider === provider)
        const model = resolveDefaultModel(provider, liveProvider)
        const threadId = await params.create({
          provider,
          model,
          projectId: params.targetProjectId,
          navigate: params.onCreated === undefined,
        })
        await finalizeSessionCreation({
          threadId,
          onCreated: params.onCreated,
          onClose: params.onClose,
          isSidebarMobile: params.isSidebarMobile,
          setOpenMobile: params.setOpenMobile,
        })
      } catch (err) {
        params.setCreateError(err instanceof Error ? err.message : 'Failed to create session.')
      } finally {
        params.setPendingProvider(null)
      }
    },
    [params]
  )
}

export function NewSessionModal(props: NewSessionModalProps): React.JSX.Element {
  const { open, onClose, projectId, onCreated } = props
  const { create } = useNewSessionCreate()
  const liveProviders = useServerProviders()
  const { state: sidebarState, isMobile: isSidebarMobile, setOpenMobile } = useSidebar()
  const { activeDraftThread, activeThread, defaultProjectId } = useHandleNewThread()
  const shouldOffsetSidebar = sidebarState === 'expanded' && !isSidebarMobile
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingProvider, setPendingProvider] = useState<ProviderKind | null>(null)
  const targetProjectId = resolveNewSessionProjectId({
    projectId,
    activeThreadProjectId: activeThread?.projectId ?? null,
    activeDraftThreadProjectId: activeDraftThread?.projectId ?? null,
    defaultProjectId,
  })
  const resetModalState = useCallback(() => {
    setCreateError(null)
    setPendingProvider(null)
  }, [])
  const handleSelect = useNewSessionSelection({
    create,
    liveProviders,
    targetProjectId,
    onCreated,
    onClose,
    isSidebarMobile,
    setOpenMobile,
    setCreateError,
    setPendingProvider,
  })

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => handleNewSessionOpenChange(nextOpen, resetModalState, onClose)}
    >
      <DialogPopup
        showCloseButton
        className="max-w-3xl"
        {...(shouldOffsetSidebar ? { viewportClassName: 'md:ps-[16rem]' } : {})}
      >
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {createError && (
            <p className="mb-3 rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive">
              {createError}
            </p>
          )}
          <NewSessionModalProviderStep
            pendingProvider={pendingProvider}
            onSelect={provider => {
              void handleSelect(provider)
            }}
          />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  )
}
