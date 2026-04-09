import type { Skill } from '@orxa-code/contracts'
import { ThreadId } from '@orxa-code/contracts'
import { useNavigate } from '@tanstack/react-router'
import { ZapIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { useComposerDraftStore } from '../../composerDraftStore'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { cn } from '~/lib/utils'

const PROVIDER_LABELS: Record<Skill['provider'], string> = {
  codex: 'Codex',
  claudeAgent: 'Claude',
  opencode: 'OpenCode',
}

interface SkillCardProps {
  skill: Skill
  activeThreadId: string | null
}

export function SkillCard({ skill, activeThreadId }: SkillCardProps): ReactNode {
  const navigate = useNavigate()
  const setPrompt = useComposerDraftStore(s => s.setPrompt)
  const getDraft = useComposerDraftStore(s => s.draftsByThreadId)

  const canUse = activeThreadId !== null

  function handleUse() {
    if (!activeThreadId) return
    const threadId = ThreadId.makeUnsafe(activeThreadId)
    const current = getDraft[threadId]?.prompt ?? ''
    const token = `@${skill.id}`
    const next = current.length > 0 ? `${current} ${token} ` : `${token} `
    setPrompt(threadId, next)
    void navigate({ to: '/$threadId', params: { threadId: activeThreadId } })
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-xs/5 transition-shadow hover:shadow-sm'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{skill.name}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {skill.description || 'No description.'}
          </p>
        </div>
        <Badge variant="outline" size="sm" className="shrink-0 capitalize">
          {PROVIDER_LABELS[skill.provider]}
        </Badge>
      </div>

      {skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skill.tags.slice(0, 4).map(tag => (
            <Badge key={tag} variant="secondary" size="sm">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-auto flex justify-end pt-1">
        <Button
          size="xs"
          variant="outline"
          disabled={!canUse}
          onClick={handleUse}
          title={canUse ? `Insert @${skill.id} into composer` : 'Open a thread to use this skill'}
        >
          <ZapIcon />
          Use
        </Button>
      </div>
    </div>
  )
}
