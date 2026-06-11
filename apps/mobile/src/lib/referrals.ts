/**
 * Referral hooks — codes, attributions (pendaftar), commissions, claims.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

export interface ReferralCommissionSummary {
  lifetimeIdr: number
  pendingIdr: number
  readyToClaimIdr: number
  paidIdr: number
}

export interface ReferralCode {
  id: string
  code: string
  label: string | null
  discountPct: number
  commissionPct: number
  isActive: boolean
  uses: number
  createdAt: string
}

export interface ReferralAttribution {
  id: string
  tenantName: string
  signedUpAt: string
  status: string
  firstPaidAt: string | null
  lifetimeCommissionIdr: number
}

export interface ReferralCommissionRow {
  id: string
  amountIdr: number
  status: 'pending' | 'ready' | 'paid' | 'reversed' | string
  attributedTenantName: string | null
  createdAt: string
}

export interface ReferralClaimRow {
  id: string
  amountIdr: number
  status: 'submitted' | 'approved' | 'paid' | 'rejected' | string
  submittedAt: string
  resolvedAt: string | null
  note: string | null
}

export interface PayoutMethod {
  id: string
  bankName: string
  accountNumber: string
  accountHolder: string
}

function inv(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['referrals'] })
}

export function useReferralCap() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['referrals', 'cap', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<{ capPct: number }>('getReferralCap', {}, { tenantId }),
  })
}

export function useMyReferralCodes() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['referrals', 'codes', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<ReferralCode[]>('listMyReferralCodes', {}, { tenantId }),
  })
}

export function useCreateReferralCode() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      code: string
      label?: string
      discountPct: number
      commissionPct: number
    }) =>
      callServerFn<ReferralCode>('createReferralCode', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useUpdateReferralCode() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: string
      label?: string | null
      discountPct?: number
      commissionPct?: number
    }) =>
      callServerFn<ReferralCode>('updateReferralCode', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useToggleReferralCode() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      callServerFn<ReferralCode>('toggleReferralCode', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useMyAttributions(search?: string) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['referrals', 'attributions', tenantId, search],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<{ items: ReferralAttribution[]; total: number }>(
        'listMyAttributions',
        { search, page: 1, pageSize: 100 },
        { tenantId },
      ),
  })
}

export function useMyCommissionSummary() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['referrals', 'summary', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<ReferralCommissionSummary>(
        'getMyCommissionSummary',
        {},
        { tenantId },
      ),
  })
}

export function useMyCommissions() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['referrals', 'commissions', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<ReferralCommissionRow[]>(
        'listMyCommissions',
        {},
        { tenantId },
      ),
  })
}

export function useMyClaimRequests() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['referrals', 'claims', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<ReferralClaimRow[]>(
        'listMyClaimRequests',
        {},
        { tenantId },
      ),
  })
}

export function useMyPayoutMethod() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['referrals', 'payout', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<PayoutMethod | null>(
        'getMyPayoutMethod',
        {},
        { tenantId },
      ),
  })
}

export function useUpsertPayoutMethod() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      bankName: string
      accountNumber: string
      accountHolder: string
    }) =>
      callServerFn<PayoutMethod>('upsertPayoutMethod', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useSubmitClaimRequest() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      callServerFn<{ id: string }>('submitClaimRequest', {}, { tenantId }),
    onSuccess: () => inv(qc),
  })
}
