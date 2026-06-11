import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import {
  endImpersonation,
  getImpersonationState,
  startImpersonation,
} from '@/server/functions/impersonation'

export function useImpersonationState() {
  return useQuery({
    queryKey: ['impersonation-state'],
    queryFn: () => getImpersonationState(),
    staleTime: 30 * 1000,
  })
}

export function useStartImpersonation() {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useMutation({
    mutationFn: (tenantId: string) =>
      startImpersonation({ data: { tenantId } }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['impersonation-state'] })
      queryClient.invalidateQueries({ queryKey: ['current-user'] })
      await router.invalidate()
    },
  })
}

export function useEndImpersonation() {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useMutation({
    mutationFn: () => endImpersonation(),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['impersonation-state'] })
      queryClient.invalidateQueries({ queryKey: ['current-user'] })
      await router.invalidate()
    },
  })
}
