/**
 * Settings hooks: account password, announcements admin CRUD, tenant
 * members + roles management.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

// ─── Auth password ─────────────────────────────────────────────────

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: {
      currentPassword: string
      newPassword: string
      confirmPassword: string
    }) => callServerFn<{ success: true }>('changePassword', input),
  })
}

export function useSetAuthPassword() {
  return useMutation({
    mutationFn: (input: { newPassword: string; confirmPassword: string }) =>
      callServerFn<{ success: true }>('setAuthPassword', input),
  })
}

// ─── Announcements admin ──────────────────────────────────────────

export interface AdminAnnouncement {
  id: string
  title: string
  body: string
  pinned: boolean
  expiresAt: string | null
  authorUserId: string
  authorName: string | null
  createdAt: string
  updatedAt: string
}

interface AnnouncementsAdminResponse {
  items: AdminAnnouncement[]
  total: number
  page: number
  pageSize: number
}

export function useAnnouncementsAdmin() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['settings', 'announcements-admin', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<AnnouncementsAdminResponse>(
        'listAnnouncementsAdmin',
        {},
        { tenantId },
      ),
  })
}

interface AnnouncementWriteInput {
  id?: string
  title: string
  body: string
  pinned?: boolean
  expiresAt?: string | null
}

function inv(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['settings'] })
  void qc.invalidateQueries({ queryKey: ['announcements'] })
}

export function useCreateAnnouncement() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<AnnouncementWriteInput, 'id'>) =>
      callServerFn<AdminAnnouncement>(
        'createAnnouncement',
        input,
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useUpdateAnnouncement() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AnnouncementWriteInput & { id: string }) =>
      callServerFn<AdminAnnouncement>(
        'updateAnnouncement',
        input,
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useDeleteAnnouncement() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteAnnouncement',
        { id },
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

// ─── Tenant members ───────────────────────────────────────────────

export interface TenantMember {
  userId: string
  email: string | null
  phone: string | null
  firstName: string | null
  lastName: string | null
  roleKey: string
  roleLabel: string | null
  branches: Array<{ id: string; name: string }>
  isActive: boolean
  joinedAt: string | null
}

export function useTenantMembers() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['settings', 'tenant-members', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<TenantMember[]>(
        'listTenantMembers',
        {},
        { tenantId },
      ),
  })
}

export interface AssignableRole {
  key: string
  label: string
  isSystem: boolean
}

export function useRolesForAssignment() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['settings', 'roles-for-assignment', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<AssignableRole[]>(
        'getRolesForAssignment',
        {},
        { tenantId },
      ),
  })
}

export function useTenantBranchesForMembers() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['settings', 'branches-for-members', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<Array<{ id: string; name: string }>>(
        'listTenantBranchesForMembers',
        {},
        { tenantId },
      ),
  })
}

interface InviteEmailInput {
  email: string
  firstName: string
  lastName?: string
  roleKey: string
  branchIds?: string[]
}

export function useInviteTenantMember() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: InviteEmailInput) =>
      callServerFn<TenantMember>('inviteTenantMember', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

interface InvitePhoneInput {
  phone: string
  firstName: string
  lastName?: string
  roleKey: string
  branchIds?: string[]
}

export function useInvitePhoneOnlyMember() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: InvitePhoneInput) =>
      callServerFn<TenantMember>(
        'invitePhoneOnlyTenantMember',
        input,
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useUpdateTenantMemberRole() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { userId: string; roleKey: string }) =>
      callServerFn<{ success: true }>(
        'updateTenantMemberRole',
        input,
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useUpdateTenantMemberProfile() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      userId: string
      firstName?: string
      lastName?: string
    }) =>
      callServerFn<{ success: true }>(
        'updateTenantMemberProfile',
        input,
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useSetTenantMemberBranches() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { userId: string; branchIds: string[] }) =>
      callServerFn<{ success: true }>(
        'setTenantMemberBranches',
        input,
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useRemoveTenantMember() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      callServerFn<{ success: true }>(
        'removeTenantMember',
        { userId },
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

// ─── Roles + permissions ──────────────────────────────────────────

export interface TenantRoleRow {
  key: string
  label: string
  isSystem: boolean
  permissions: string[]
  memberCount: number
}

export function useTenantRoles() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['settings', 'roles', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<TenantRoleRow[]>(
        'listTenantRoles',
        {},
        { tenantId },
      ),
  })
}

export interface PermissionDef {
  key: string
  label: string
  module: string
}

export function useAllPermissions() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['settings', 'permissions', tenantId],
    enabled: !!tenantId,
    staleTime: 30 * 60 * 1000,
    queryFn: () =>
      callServerFn<PermissionDef[]>(
        'listAllPermissions',
        {},
        { tenantId },
      ),
  })
}

interface UpsertRoleInput {
  key?: string
  label: string
  permissions: string[]
}

export function useCreateTenantRole() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<UpsertRoleInput, 'key'>) =>
      callServerFn<TenantRoleRow>('createTenantRole', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useUpdateTenantRole() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertRoleInput & { key: string }) =>
      callServerFn<TenantRoleRow>('updateTenantRole', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useDeleteTenantRole() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) =>
      callServerFn<{ success: true }>(
        'deleteTenantRole',
        { key },
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}
