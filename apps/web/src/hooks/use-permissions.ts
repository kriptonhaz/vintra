import { useQuery } from '@tanstack/react-query'
import { getCurrentUser } from '@/server/functions/auth'
import { hasPermission, hasAnyPermission } from '@/lib/permissions'

export function useCurrentUser() {
  return useQuery({
    queryKey: ['current-user'],
    queryFn: () => getCurrentUser(),
    staleTime: 5 * 60 * 1000,
  })
}

export function usePermissions() {
  const { data, isLoading } = useCurrentUser()
  const permissions = data?.permissions ?? []
  return {
    permissions,
    isLoading,
    has: (key: string) => hasPermission(permissions, key),
    hasAny: (keys: string[]) => hasAnyPermission(permissions, keys),
    role: data?.roleKey ?? null,
  }
}
