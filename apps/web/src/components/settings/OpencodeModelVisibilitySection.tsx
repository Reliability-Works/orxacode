import { ChevronDownIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ServerProviderModel } from '@orxa-code/contracts'
import { Checkbox } from '../ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { cn } from '~/lib/utils'
import {
  groupOpencodeModelsBySubprovider,
  normalizeOpencodeHiddenModelSlugs,
} from '../../opencodeModelGroups'

function buildNextHiddenModelSlugs(
  hiddenModelSlugs: ReadonlyArray<string>,
  slug: string,
  hidden: boolean
): ReadonlyArray<string> {
  const next = new Set(normalizeOpencodeHiddenModelSlugs(hiddenModelSlugs))
  if (hidden) next.add(slug)
  else next.delete(slug)
  return [...next].sort((a, b) => a.localeCompare(b))
}

interface OpencodeModelVisibilitySectionProps {
  models: ReadonlyArray<ServerProviderModel>
  hiddenModelSlugs: ReadonlyArray<string>
  onHiddenModelSlugsChange: (hiddenModelSlugs: ReadonlyArray<string>) => void
}

function OpencodeModelGroupRow(props: {
  model: ServerProviderModel
  hiddenModelSlugs: ReadonlyArray<string>
  onHiddenModelSlugsChange: (hiddenModelSlugs: ReadonlyArray<string>) => void
}) {
  const isVisible = !props.hiddenModelSlugs.includes(props.model.slug)

  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40">
      <Checkbox
        checked={isVisible}
        onCheckedChange={checked =>
          props.onHiddenModelSlugsChange(
            buildNextHiddenModelSlugs(props.hiddenModelSlugs, props.model.slug, !checked)
          )
        }
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-foreground/90">{props.model.name}</div>
        <code className="block truncate text-mini text-muted-foreground">{props.model.slug}</code>
      </div>
    </label>
  )
}

function OpencodeModelGroupSection(props: {
  group: ReturnType<typeof groupOpencodeModelsBySubprovider<ServerProviderModel>>[number]
  hiddenModelSlugs: ReadonlyArray<string>
  onHiddenModelSlugsChange: (hiddenModelSlugs: ReadonlyArray<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const hiddenSet = useMemo(() => new Set(props.hiddenModelSlugs), [props.hiddenModelSlugs])
  const visibleCount = props.group.options.filter(option => !hiddenSet.has(option.slug)).length
  const allVisible = visibleCount === props.group.options.length
  const noneVisible = visibleCount === 0

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border/60 bg-background/40">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Checkbox
            checked={allVisible}
            indeterminate={!allVisible && !noneVisible}
            onCheckedChange={checked => {
              const shouldHide = !checked
              let nextHidden = normalizeOpencodeHiddenModelSlugs(props.hiddenModelSlugs)
              for (const option of props.group.options) {
                nextHidden = buildNextHiddenModelSlugs(nextHidden, option.slug, shouldHide)
              }
              props.onHiddenModelSlugsChange(nextHidden)
            }}
          />
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-foreground">
                {props.group.label}
              </div>
              <div className="text-mini text-muted-foreground">
                {visibleCount} of {props.group.options.length} visible in composer
              </div>
            </div>
            <ChevronDownIcon
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-180'
              )}
            />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="border-t border-border/60 px-1 py-1">
            {props.group.options.map(model => (
              <OpencodeModelGroupRow
                key={model.slug}
                model={model}
                hiddenModelSlugs={props.hiddenModelSlugs}
                onHiddenModelSlugsChange={props.onHiddenModelSlugsChange}
              />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

export function OpencodeModelVisibilitySection(props: OpencodeModelVisibilitySectionProps) {
  const groups = useMemo(() => groupOpencodeModelsBySubprovider(props.models), [props.models])

  return (
    <div className="mt-3 space-y-2">
      <div className="text-xs font-medium text-foreground">Composer model visibility</div>
      <div className="text-xs text-muted-foreground">
        Hide Opencode models from the composer picker without affecting provider availability.
      </div>
      <div className="space-y-2">
        {groups.map(group => (
          <OpencodeModelGroupSection
            key={group.providerId}
            group={group}
            hiddenModelSlugs={props.hiddenModelSlugs}
            onHiddenModelSlugsChange={props.onHiddenModelSlugsChange}
          />
        ))}
      </div>
    </div>
  )
}
