import { cva } from 'class-variance-authority'

export const selectTriggerVariants = cva(
  "relative inline-flex select-none items-center justify-between gap-2 border rounded-lg text-left text-base outline-none transition-[color,box-shadow,background-color] data-disabled:pointer-events-none data-disabled:opacity-64 sm:text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      variant: {
        default:
          "w-full min-w-36 border-input bg-background not-dark:bg-clip-padding text-foreground shadow-xs/5 ring-ring/24 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/16 dark:bg-input/32 dark:aria-invalid:ring-destructive/24 dark:not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [&_svg:not([class*='opacity-'])]:opacity-80 [[data-disabled],:focus-visible,[aria-invalid],[data-pressed]]:shadow-none",
        ghost:
          'border-transparent text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent [:hover,[data-pressed]]:text-foreground/80',
      },
      size: {
        default: 'min-h-9 px-[calc(--spacing(3)-1px)] sm:min-h-8',
        lg: 'min-h-10 px-[calc(--spacing(3)-1px)] sm:min-h-9',
        sm: 'min-h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:min-h-7',
        xs: "h-7 gap-1 rounded-md px-[calc(--spacing(2)-1px)] text-sm before:rounded-[calc(var(--radius-md)-1px)] sm:h-6 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
      },
    },
  }
)
