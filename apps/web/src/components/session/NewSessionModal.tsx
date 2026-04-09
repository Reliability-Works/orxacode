import type * as React from 'react'
import { useCallback, useState } from 'react'
import type { ProjectId, ProviderKind, ServerProvider } from '@orxa-code/contracts'
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
}

function resolveDefaultModel(
  provider: ProviderKind,
  liveProvider: ServerProvider | undefined
): string {
  const firstModel = liveProvider?.models[0]?.slug
  return firstModel ?? DEFAULT_MODEL_BY_PROVIDER[provider]
}

export function NewSessionModal(props: NewSessionModalProps): React.JSX.Element {
  const { open, onClose, projectId } = props
  const { create } = useNewSessionCreate()
  const liveProviders = useServerProviders()
  const { state: sidebarState, isMobile: isSidebarMobile } = useSidebar()
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

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) {
      setCreateError(null)
      setPendingProvider(null)
      onClose()
    }
  }

  const handleSelect = useCallback(
    async (provider: ProviderKind): Promise<void> => {
      setCreateError(null)
      setPendingProvider(provider)
      try {
        const liveProvider = liveProviders.find(p => p.provider === provider)
        const model = resolveDefaultModel(provider, liveProvider)
        await create({ provider, model, projectId: targetProjectId })
        onClose()
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : 'Failed to create session.')
      } finally {
        setPendingProvider(null)
      }
    },
    [create, liveProviders, onClose, targetProjectId]
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
