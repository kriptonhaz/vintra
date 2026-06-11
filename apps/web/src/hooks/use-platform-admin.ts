import { useQuery } from '@tanstack/react-query'
import { getPlatformAdminStatus } from '@/server/functions/admin'

export function usePlatformAdmin() {
  return useQuery({
    queryKey: ['platform-admin-status'],
    queryFn: () => getPlatformAdminStatus(),
    staleTime: 5 * 60 * 1000,
  })
}
