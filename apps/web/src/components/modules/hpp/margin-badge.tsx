import { Badge } from '@/components/ui/badge'

interface MarginBadgeProps {
  margin: number | null
}

export function MarginBadge({ margin }: MarginBadgeProps) {
  if (margin === null) {
    return (
      <Badge variant="outline">
        -
      </Badge>
    )
  }

  return (
    <Badge variant="default">
      {margin.toFixed(1)}%
    </Badge>
  )
}

export { type MarginBadgeProps }
