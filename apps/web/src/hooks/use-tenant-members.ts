import { useQuery } from '@tanstack/react-query'
import {
  listTenantMembers,
  getRolesForAssignment,
} from '@/server/functions/tenant-members'

export function useTenantMembers() {
  return useQuery({
    queryKey: ['tenant', 'members'],
    queryFn: () => listTenantMembers(),
    staleTime: 60 * 1000,
  })
}

export function useAssignableRoles() {
  return useQuery({
    queryKey: ['roles', 'assignable'],
    queryFn: () => getRolesForAssignment(),
    staleTime: 10 * 60 * 1000,
  })
}
