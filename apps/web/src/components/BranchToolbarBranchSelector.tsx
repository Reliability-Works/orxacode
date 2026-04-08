import { ChevronDownIcon } from 'lucide-react'

import {
  BranchToolbarBranchSelectorProps,
  useBranchSelectorState,
} from './BranchToolbarBranchSelector.state'
import { EnvMode } from './BranchToolbar.logic'
import { Button } from './ui/button'
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxPopup,
  ComboboxTrigger,
} from './ui/combobox'
import { NonVirtualizedBranchList, VirtualizedBranchList } from './BranchToolbarVirtualList'

function getBranchTriggerLabel(input: {
  activeWorktreePath: string | null
  effectiveEnvMode: EnvMode
  resolvedActiveBranch: string | null
}): string {
  const { activeWorktreePath, effectiveEnvMode, resolvedActiveBranch } = input
  if (!resolvedActiveBranch) return 'Select branch'
  if (effectiveEnvMode === 'worktree' && !activeWorktreePath) return `From ${resolvedActiveBranch}`
  return resolvedActiveBranch
}

export function BranchToolbarBranchSelector(props: BranchToolbarBranchSelectorProps) {
  const { activeProjectCwd, activeWorktreePath, effectiveEnvMode } = props
  const s = useBranchSelectorState(props)
  const triggerLabel = getBranchTriggerLabel({
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch: s.resolvedActiveBranch,
  })
  const sharedListProps = {
    filteredBranchPickerItems: s.filteredBranchPickerItems,
    checkoutPullRequestItemValue: s.checkoutPullRequestItemValue,
    createBranchItemValue: s.createBranchItemValue,
    prReference: s.prReference,
    trimmedBranchQuery: s.trimmedBranchQuery,
    branchByName: s.branchByName,
    activeProjectCwd,
    onSelectBranch: s.selectBranch,
    onCheckoutPr: s.onCheckoutPr,
    onCreateBranch: s.createBranch,
  }
  return (
    <Combobox
      items={s.branchPickerItems}
      filteredItems={s.filteredBranchPickerItems}
      autoHighlight
      virtualized={s.shouldVirtualizeBranchList}
      onItemHighlighted={(_v, e) => {
        if (s.isBranchMenuOpen && e.index >= 0)
          s.scrollToIndexRef.current?.(e.index, { align: 'auto' })
      }}
      onOpenChange={s.handleOpenChange}
      open={s.isBranchMenuOpen}
      value={s.resolvedActiveBranch}
    >
      <ComboboxTrigger
        render={<Button variant="ghost" size="xs" />}
        className="text-muted-foreground/70 hover:text-foreground/80"
        disabled={(s.branchesQuery.isLoading && s.branches.length === 0) || s.isBranchActionPending}
      >
        <span className="max-w-[240px] truncate">{triggerLabel}</span>
        <ChevronDownIcon />
      </ComboboxTrigger>
      <ComboboxPopup align="end" side="top" className="w-80">
        <div className="border-b p-1">
          <ComboboxInput
            className="[&_input]:font-sans rounded-md"
            inputClassName="ring-0"
            placeholder="Search branches..."
            showTrigger={false}
            size="sm"
            value={s.branchQuery}
            onChange={e => s.setBranchQuery(e.target.value)}
          />
        </div>
        <ComboboxEmpty>No branches found.</ComboboxEmpty>
        {s.shouldVirtualizeBranchList ? (
          <VirtualizedBranchList
            {...sharedListProps}
            isBranchMenuOpen={s.isBranchMenuOpen}
            onScrollToIndex={s.handleScrollToIndex}
          />
        ) : (
          <NonVirtualizedBranchList {...sharedListProps} />
        )}
      </ComboboxPopup>
    </Combobox>
  )
}
