/**
 * Composer body — frame, header, attachments, editor, footer.
 *
 * Extracted from ChatView.tsx. Split into smaller sub-components to satisfy
 * max-lines-per-function.
 */

import { cn } from '~/lib/utils'
import { ComposerPromptEditor } from '../ComposerPromptEditor'
import { ComposerCommandMenu } from './ComposerCommandMenu'
import { ChatViewComposerAttachments } from './ChatViewComposerAttachments'
import { ChatViewComposerHeaderPanel } from './ChatViewComposerHeaderPanel'
import { ChatViewComposerFooterPanel } from './ChatViewComposerFooterPanel'
import { ComposerQueuedMessagesTray } from './ComposerQueuedMessagesTray'
import { TraitsMenuContent, TraitsPicker } from './TraitsPicker'
import { deriveComposerPlaceholder } from './ChatViewComposerBody.helpers'
import { useChatViewCtx } from './ChatViewContext'

function useProviderTraits() {
  const c = useChatViewCtx()
  const { td, store } = c
  const traitProps = {
    provider: td.selectedProvider,
    threadId: c.threadId,
    model: td.selectedModel,
    models: td.selectedProviderModels,
    modelOptions: td.composerModelOptions?.[td.selectedProvider],
    prompt: store.prompt,
    onPromptChange: c.setPromptFromTraits,
  }
  const menuContent = <TraitsMenuContent {...traitProps} />
  const picker = <TraitsPicker {...traitProps} />
  return { menuContent, picker }
}

function ComposerAttachmentsBlock() {
  const c = useChatViewCtx()
  const { store, ad, cd, ls } = c
  const isComposerApprovalState = ad.activePendingApproval !== null
  if (isComposerApprovalState || ad.pendingUserInputs.length > 0) return null
  return (
    <ChatViewComposerAttachments
      images={store.composerImages}
      nonPersistedImageIdSet={cd.nonPersistedComposerImageIdSet}
      onExpandImage={preview => ls.setExpandedImage(preview)}
      onRemoveImage={id => c.removeComposerImage(id)}
    />
  )
}

function ComposerEditorBlock() {
  const c = useChatViewCtx()
  const { td, ad, p, store } = c
  const { composerEditorRef, composerCursor } = c.ls
  const isComposerApprovalState = ad.activePendingApproval !== null
  return (
    <ComposerPromptEditor
      ref={composerEditorRef}
      value={
        isComposerApprovalState
          ? ''
          : ad.activePendingProgress
            ? ad.activePendingProgress.customAnswer
            : store.prompt
      }
      cursor={composerCursor}
      terminalContexts={
        !isComposerApprovalState && ad.pendingUserInputs.length === 0
          ? store.composerTerminalContexts
          : []
      }
      onRemoveTerminalContext={c.removeComposerTerminalContextFromDraft}
      onChange={c.onPromptChange}
      onCommandKeyDown={c.onComposerCommandKey}
      onPaste={c.onComposerPaste}
      placeholder={deriveComposerPlaceholder(
        isComposerApprovalState,
        ad.activePendingApproval?.detail,
        Boolean(ad.activePendingProgress),
        p.showPlanFollowUpPrompt,
        Boolean(p.activeProposedPlan),
        td.phase
      )}
      disabled={isComposerApprovalState}
    />
  )
}

function ComposerCommandMenuBlock() {
  const c = useChatViewCtx()
  const { cd, store, ls, ad } = c
  const isComposerApprovalState = ad.activePendingApproval !== null
  if (!cd.composerMenuOpen || isComposerApprovalState) return null
  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2 px-1">
      <ComposerCommandMenu
        items={cd.composerMenuItems}
        resolvedTheme={store.resolvedTheme}
        isLoading={cd.isComposerMenuLoading}
        triggerKind={cd.composerTriggerKind}
        activeItemId={cd.activeComposerMenuItem?.id ?? null}
        onHighlightedItemChange={id => ls.setComposerHighlightedItemId(id)}
        onSelect={c.onSelectComposerItem}
      />
    </div>
  )
}

export function ChatViewComposerBody() {
  const c = useChatViewCtx()
  const { td, ad, p } = c
  const { composerProviderState } = td
  const { onComposerDragEnter, onComposerDragOver, onComposerDragLeave, onComposerDrop } = c
  const isDragOverComposer = c.ls.isDragOverComposer
  const hasComposerHeader = Boolean(
    ad.activePendingApproval ||
    ad.pendingUserInputs.length > 0 ||
    (p.showPlanFollowUpPrompt && p.activeProposedPlan)
  )
  const traits = useProviderTraits()
  return (
    <div
      className={cn(
        'group rounded-[22px] p-px transition-colors duration-200',
        composerProviderState.composerFrameClassName
      )}
      onDragEnter={onComposerDragEnter}
      onDragOver={onComposerDragOver}
      onDragLeave={onComposerDragLeave}
      onDrop={onComposerDrop}
    >
      <ComposerQueuedMessagesTray />
      <div
        className={cn(
          'rounded-[20px] border bg-card transition-colors duration-200 has-focus-visible:border-ring/45',
          isDragOverComposer ? 'border-primary/70 bg-accent/30' : 'border-border',
          composerProviderState.composerSurfaceClassName
        )}
      >
        <ChatViewComposerHeaderPanel />
        <div
          className={cn(
            'relative px-3 pb-2 sm:px-4',
            hasComposerHeader ? 'pt-2.5 sm:pt-3' : 'pt-3.5 sm:pt-4'
          )}
        >
          <ComposerCommandMenuBlock />
          <ComposerAttachmentsBlock />
          <ComposerEditorBlock />
        </div>
        <ChatViewComposerFooterPanel
          providerTraitsMenuContent={traits.menuContent}
          providerTraitsPicker={traits.picker}
        />
      </div>
    </div>
  )
}
