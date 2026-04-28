import { useMemo, useState } from 'react'
import { SquarePenIcon } from 'lucide-react'
import { type ProviderKind, DEFAULT_MODEL_BY_PROVIDER } from '@orxa-code/contracts'
import { resolveSelectableModel } from '@orxa-code/shared/model'

import { useServerConfig } from '../rpc/serverState'
import { buildModelOptionsByProvider } from './chat/useChatViewDerivedThread'
import { ProviderOptionsMenu } from './chat/ProviderModelPicker'
import { Menu, MenuPopup, MenuTrigger } from './ui/menu'
import { Tooltip, TooltipPopup, TooltipTrigger } from './ui/tooltip'
import { useNewChatCreate } from '../hooks/useNewChatCreate'

const EMPTY_HIDDEN_MODELS: readonly string[] = []

export function SidebarNewChatMenu() {
  const [open, setOpen] = useState(false)
  const serverConfig = useServerConfig()
  const { create } = useNewChatCreate()
  const providerStatuses = useMemo(() => serverConfig?.providers ?? [], [serverConfig?.providers])
  const modelOptionsByProvider = useMemo(
    () => buildModelOptionsByProvider([...providerStatuses], EMPTY_HIDDEN_MODELS),
    [providerStatuses]
  )

  const handleValueChange = (provider: ProviderKind, value: string) => {
    if (!value) return
    const resolved = resolveSelectableModel(provider, value, modelOptionsByProvider[provider])
    if (!resolved) return
    setOpen(false)
    void create({ provider, model: resolved })
  }

  const fallbackProvider: ProviderKind = 'codex'
  const fallbackModel = DEFAULT_MODEL_BY_PROVIDER[fallbackProvider]

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label="New chat"
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                />
              }
            >
              <SquarePenIcon className="size-3.5" />
            </MenuTrigger>
          }
        />
        <TooltipPopup side="right">New chat</TooltipPopup>
      </Tooltip>
      <MenuPopup align="start" sideOffset={4}>
        <ProviderOptionsMenu
          provider={fallbackProvider}
          model={fallbackModel}
          providers={providerStatuses}
          modelOptionsByProvider={modelOptionsByProvider}
          onValueChange={handleValueChange}
          onClose={() => setOpen(false)}
        />
      </MenuPopup>
    </Menu>
  )
}
