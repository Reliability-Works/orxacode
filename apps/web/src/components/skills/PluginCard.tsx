import type { ProviderPluginDescriptor } from '@orxa-code/contracts'
import type { ReactNode } from 'react'

import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { cn } from '~/lib/utils'

const PROVIDER_LABELS: Record<ProviderPluginDescriptor['provider'], string> = {
  codex: 'Codex',
  claudeAgent: 'Claude',
  opencode: 'OpenCode',
}

export function PluginCard({ plugin }: { plugin: ProviderPluginDescriptor }): ReactNode {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-xs/5 transition-shadow hover:shadow-sm'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {plugin.displayName ?? plugin.name}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {plugin.shortDescription ?? plugin.longDescription ?? 'No description.'}
          </p>
        </div>
        <Badge variant="outline" size="sm" className="shrink-0 capitalize">
          {PROVIDER_LABELS[plugin.provider]}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1">
        <Badge variant={plugin.enabled ? 'secondary' : 'outline'} size="sm">
          {plugin.enabled ? 'Enabled' : plugin.installed ? 'Installed' : 'Catalog'}
        </Badge>
        <Badge variant="outline" size="sm">
          {plugin.marketplaceName}
        </Badge>
        {plugin.category ? (
          <Badge variant="outline" size="sm">
            {plugin.category}
          </Badge>
        ) : null}
      </div>

      {plugin.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {plugin.tags.slice(0, 4).map(tag => (
            <Badge key={tag} variant="secondary" size="sm">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      {plugin.homepage ? (
        <div className="mt-auto flex justify-end pt-1">
          <Button
            size="xs"
            variant="outline"
            render={
              <a href={plugin.homepage} target="_blank" rel="noreferrer">
                Open
              </a>
            }
          >
            Open
          </Button>
        </div>
      ) : null}
    </div>
  )
}
