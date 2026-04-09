import type { GitBranch } from '@orxa-code/contracts'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type CSSProperties, useCallback, useEffect, useRef } from 'react'

import { ComboboxItem, ComboboxList } from './ui/combobox'

interface BranchPickerItemSharedProps {
  checkoutPullRequestItemValue: string | null
  createBranchItemValue: string | null
  prReference: string | null
  trimmedBranchQuery: string
  branchByName: Map<string, GitBranch>
  activeProjectCwd: string
  onSelectBranch: (branch: GitBranch) => void
  onCheckoutPr: (reference: string) => void
  onCreateBranch: (name: string) => void
}

interface BranchPickerItemProps extends BranchPickerItemSharedProps {
  itemValue: string
  index: number
  style?: CSSProperties
}

export function BranchPickerItem({
  itemValue,
  index,
  style,
  checkoutPullRequestItemValue,
  createBranchItemValue,
  prReference,
  trimmedBranchQuery,
  branchByName,
  activeProjectCwd,
  onSelectBranch,
  onCheckoutPr,
  onCreateBranch,
}: BranchPickerItemProps) {
  if (checkoutPullRequestItemValue && itemValue === checkoutPullRequestItemValue) {
    return (
      <ComboboxItem
        hideIndicator
        key={itemValue}
        index={index}
        value={itemValue}
        style={style}
        onClick={() => {
          if (prReference) onCheckoutPr(prReference)
        }}
      >
        <div className="flex min-w-0 flex-col items-start py-1">
          <span className="truncate font-medium">Checkout Pull Request</span>
          <span className="truncate text-muted-foreground text-xs">{prReference}</span>
        </div>
      </ComboboxItem>
    )
  }
  if (createBranchItemValue && itemValue === createBranchItemValue) {
    return (
      <ComboboxItem
        hideIndicator
        key={itemValue}
        index={index}
        value={itemValue}
        style={style}
        onClick={() => onCreateBranch(trimmedBranchQuery)}
      >
        <span className="truncate">Create new branch "{trimmedBranchQuery}"</span>
      </ComboboxItem>
    )
  }
  const branch = branchByName.get(itemValue)
  if (!branch) return null
  const hasSecondaryWorktree = branch.worktreePath && branch.worktreePath !== activeProjectCwd
  const badge = branch.current
    ? 'current'
    : hasSecondaryWorktree
      ? 'worktree'
      : branch.isRemote
        ? 'remote'
        : branch.isDefault
          ? 'default'
          : null
  return (
    <ComboboxItem
      hideIndicator
      key={itemValue}
      index={index}
      value={itemValue}
      style={style}
      onClick={() => onSelectBranch(branch)}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="truncate">{itemValue}</span>
        {badge && <span className="shrink-0 text-[10px] text-muted-foreground/45">{badge}</span>}
      </div>
    </ComboboxItem>
  )
}

export interface NonVirtualizedBranchListProps extends BranchPickerItemSharedProps {
  filteredBranchPickerItems: string[]
}

export function NonVirtualizedBranchList({
  filteredBranchPickerItems,
  ...itemProps
}: NonVirtualizedBranchListProps) {
  return (
    <ComboboxList className="max-h-56">
      {filteredBranchPickerItems.map((itemValue, index) => (
        <BranchPickerItem key={itemValue} itemValue={itemValue} index={index} {...itemProps} />
      ))}
    </ComboboxList>
  )
}

export interface VirtualizedBranchListProps extends BranchPickerItemSharedProps {
  filteredBranchPickerItems: string[]
  isBranchMenuOpen: boolean
  onScrollToIndex: (scrollToIndex: (index: number, opts: { align: string }) => void) => void
}

export function VirtualizedBranchList({
  filteredBranchPickerItems,
  isBranchMenuOpen,
  checkoutPullRequestItemValue,
  onScrollToIndex,
  ...itemProps
}: VirtualizedBranchListProps) {
  const branchListScrollElementRef = useRef<HTMLDivElement | null>(null)
  // TanStack Virtual is not React Compiler-compatible yet; this hook is safe here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const branchListVirtualizer = useVirtualizer({
    count: filteredBranchPickerItems.length,
    estimateSize: index =>
      filteredBranchPickerItems[index] === checkoutPullRequestItemValue ? 44 : 28,
    getScrollElement: () => branchListScrollElementRef.current,
    overscan: 12,
    enabled: isBranchMenuOpen,
    initialRect: { height: 224, width: 0 },
  })
  const virtualBranchRows = branchListVirtualizer.getVirtualItems()
  const setBranchListRef = useCallback(
    (element: HTMLDivElement | null) => {
      branchListScrollElementRef.current = (element?.parentElement as HTMLDivElement | null) ?? null
      if (element) branchListVirtualizer.measure()
    },
    [branchListVirtualizer]
  )

  useEffect(() => {
    onScrollToIndex((index, opts) =>
      branchListVirtualizer.scrollToIndex(
        index,
        opts as Parameters<typeof branchListVirtualizer.scrollToIndex>[1]
      )
    )
  }, [branchListVirtualizer, onScrollToIndex])

  useEffect(() => {
    if (!isBranchMenuOpen) return
    queueMicrotask(() => {
      branchListVirtualizer.measure()
    })
  }, [branchListVirtualizer, filteredBranchPickerItems.length, isBranchMenuOpen])

  return (
    <ComboboxList ref={setBranchListRef} className="max-h-56">
      <div className="relative" style={{ height: `${branchListVirtualizer.getTotalSize()}px` }}>
        {virtualBranchRows.map(virtualRow => {
          const itemValue = filteredBranchPickerItems[virtualRow.index]
          if (!itemValue) return null
          return (
            <BranchPickerItem
              key={itemValue}
              itemValue={itemValue}
              index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
              checkoutPullRequestItemValue={checkoutPullRequestItemValue}
              {...itemProps}
            />
          )
        })}
      </div>
    </ComboboxList>
  )
}
