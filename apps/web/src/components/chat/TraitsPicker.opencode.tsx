/**
 * Opencode-specific trait sections (Primary Agent + Variant) for TraitsPicker.
 * Split from TraitsPicker.tsx to respect max-lines.
 */
import type { OpencodeAgent, ThreadId } from '@orxa-code/contracts'
import { useComposerDraftStore, useComposerThreadDraft } from '../../composerDraftStore'
import { MenuGroup, MenuRadioGroup, MenuRadioItem, MenuSeparator as MenuDivider } from '../ui/menu'
import { useOpencodePrimaryAgents } from './useOpencodePrimaryAgents'

export interface TraitsOpencodeSectionProps {
  threadId: ThreadId
  modelVariants: ReadonlyArray<string>
  disabled?: boolean
}

function formatAgentLabel(agent: OpencodeAgent): string {
  return agent.name
}

function isPlanAgent(agent: OpencodeAgent): boolean {
  return agent.name.toLowerCase() === 'plan'
}

export function TraitsOpencodeAgentSection(props: TraitsOpencodeSectionProps) {
  const { threadId, disabled = false } = props
  const { agents: allAgents, isLoading } = useOpencodePrimaryAgents(true)
  const draft = useComposerThreadDraft(threadId)
  const setOpencodeAgentId = useComposerDraftStore(store => store.setOpencodeAgentId)
  const opencodeSelection = draft.modelSelectionByProvider?.opencode
  const currentAgentId =
    opencodeSelection?.provider === 'opencode' ? (opencodeSelection.agentId ?? '') : ''
  // Hide the `plan` primary agent from the picker — plan mode is delivered
  // by the composer's Chat/Plan toggle, which routes through the plan agent
  // automatically on the server when no explicit agentId is set.
  const agents = allAgents.filter(agent => !isPlanAgent(agent))

  return (
    <>
      <MenuDivider />
      <MenuGroup>
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Primary Agent</div>
        {disabled ? (
          <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
            Plan mode is active — the plan agent will handle this turn.
          </div>
        ) : isLoading && agents.length === 0 ? (
          <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">Loading…</div>
        ) : agents.length === 0 ? (
          <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">No agents available.</div>
        ) : (
          <MenuRadioGroup
            value={currentAgentId}
            onValueChange={value => {
              setOpencodeAgentId(threadId, value.length > 0 ? value : null)
            }}
          >
            {agents.map(agent => (
              <MenuRadioItem key={agent.id} value={agent.id}>
                {formatAgentLabel(agent)}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        )}
      </MenuGroup>
    </>
  )
}

export function TraitsOpencodeVariantSection(props: TraitsOpencodeSectionProps) {
  const { threadId, modelVariants } = props
  const draft = useComposerThreadDraft(threadId)
  const setOpencodeVariant = useComposerDraftStore(store => store.setOpencodeVariant)
  if (modelVariants.length === 0) return null
  const opencodeSelection = draft.modelSelectionByProvider?.opencode
  const currentVariant =
    opencodeSelection?.provider === 'opencode' ? (opencodeSelection.variant ?? '') : ''

  return (
    <>
      <MenuDivider />
      <MenuGroup>
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Variant</div>
        <MenuRadioGroup
          value={currentVariant}
          onValueChange={value => {
            setOpencodeVariant(threadId, value.length > 0 ? value : null)
          }}
        >
          <MenuRadioItem value="">Default</MenuRadioItem>
          {modelVariants.map(variant => (
            <MenuRadioItem key={variant} value={variant}>
              {variant}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuGroup>
    </>
  )
}
