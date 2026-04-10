import type { ReactNode } from 'react'

import { Skeleton } from '../ui/skeleton'

export function GitSidebarSkeletonList(props: {
  rows: number
  className?: string
  itemClassName: string
}): ReactNode {
  return (
    <div className={props.className ?? 'flex flex-col gap-2 p-3'}>
      {Array.from({ length: props.rows }).map((_, index) => (
        <Skeleton key={index} className={props.itemClassName} />
      ))}
    </div>
  )
}

export function GitSidebarCenteredMessage(props: { children: ReactNode }): ReactNode {
  return <div className="flex flex-1 items-center justify-center p-6">{props.children}</div>
}

export function GitSidebarLinkedCard(props: {
  href: string
  header: ReactNode
  meta?: ReactNode
  footer: ReactNode
}): ReactNode {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/70 px-3 py-3 transition-colors hover:bg-accent/30"
    >
      {props.header}
      {props.meta}
      {props.footer}
    </a>
  )
}
