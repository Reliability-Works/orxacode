'use client'

import * as React from 'react'
import { cn } from '~/lib/utils'
import { Separator } from './separator'

/** Creates a separator component with a fixed base className. */
export function makeSeparatorComponent(
  baseClassName: string
): React.FC<{ className?: string } & React.ComponentProps<typeof Separator>> {
  const SeparatorComponent = function ({
    className,
    orientation = 'vertical',
    ...props
  }: {
    className?: string
  } & React.ComponentProps<typeof Separator>) {
    return (
      <Separator className={cn(baseClassName, className)} orientation={orientation} {...props} />
    )
  }
  return SeparatorComponent
}
