import * as React from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = {
  default: 'bg-primary-100 text-primary-700 border-primary-200',
  success: 'bg-success-100 text-success-700 border-success-200',
  warning: 'bg-warning-100 text-warning-700 border-warning-200',
  danger: 'bg-danger-100 text-danger-700 border-danger-200',
  outline: 'bg-transparent text-gray-700 border-gray-300 dark:text-gray-300 dark:border-gray-600',
} as const

type BadgeVariant = keyof typeof badgeVariants

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
        badgeVariants[variant],
        className,
      )}
      {...props}
    />
  )
}

export { Badge, type BadgeProps, type BadgeVariant }
