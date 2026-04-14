import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from '@orxa-code/contracts'
import { InfoIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '../ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '../ui/dialog'
import { Textarea } from '../ui/textarea'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'

export interface HandoffDialogProps {
  open: boolean
  targetProvider: ProviderKind | null
  isSubmitting: boolean
  onCancel: () => void
  onConfirm: (appendedPrompt: string | null) => void
}

function HandoffGuidanceLabel({ providerName }: { providerName: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <p className="font-medium text-xs">Additional guidance (optional)</p>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="About additional guidance"
              className="inline-flex size-3.5 items-center justify-center text-muted-foreground hover:text-foreground"
            />
          }
        >
          <InfoIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup className="max-w-xs">
          <p className="px-1 py-0.5">
            Use this to tell {providerName || 'the target provider'} what their exact task is,
            unless it's already clear from the transcript messages.
          </p>
        </TooltipPopup>
      </Tooltip>
    </div>
  )
}

export function HandoffDialog(props: HandoffDialogProps) {
  const { open, targetProvider, isSubmitting, onCancel, onConfirm } = props
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    if (open) {
      setPrompt('')
    }
  }, [open, targetProvider])

  const providerName = targetProvider ? PROVIDER_DISPLAY_NAMES[targetProvider] : ''

  function handleConfirm() {
    const trimmed = prompt.trim()
    onConfirm(trimmed.length > 0 ? trimmed : null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen && !isSubmitting) {
          onCancel()
        }
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Hand off to {providerName}</DialogTitle>
          <DialogDescription>
            The transcript and thread context will be imported automatically. Add optional guidance
            below if the task isn't clear from the transcript.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-2">
          <HandoffGuidanceLabel providerName={providerName} />
          <Textarea
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            placeholder={`e.g. "Continue implementing the diff summary feature — focus on the server-side endpoint, not the UI."`}
            size="sm"
            autoFocus
            disabled={isSubmitting}
            onKeyDown={event => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                handleConfirm()
              }
            }}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={isSubmitting || !targetProvider}>
            {isSubmitting ? 'Starting...' : `Hand off to ${providerName}`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
