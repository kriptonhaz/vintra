import { cn } from '@/lib/utils'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded-lg bg-gray-200 dark:bg-gray-600', className)}
      {...props}
    />
  )
}

export { Skeleton, type SkeletonProps }
