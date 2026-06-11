/**
 * Customer + loyalty hooks for the POS checkout flow.
 *
 * The cashier-on-mobile uses these to:
 *   1. find an existing customer by phone (typeahead in the picker sheet),
 *   2. create one on the fly with name + phone,
 *   3. show the attached customer's points balance + recent movements,
 *   4. show the attached customer's stamp cards + redeem state.
 *
 * Server fns are all already shipped (web POS uses them); this just
 * wraps them in mobile-friendly hooks and the `callServerFn` gateway.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

// ─── Search / create customer ────────────────────────────────────────

export interface CustomerSearchHit {
  id: string
  name: string
  phone: string | null
  visitCount: number
}

export function useCustomerSearch(phone: string) {
  const { tenantId } = useTenant()
  // Trim + ignore very short queries — server enforces min 2 but we
  // skip the round trip below that to keep the picker snappy.
  const q = phone.trim()
  return useQuery({
    queryKey: ['pos', 'customer-search', tenantId, q],
    enabled: !!tenantId && q.length >= 2,
    staleTime: 10 * 1000,
    queryFn: () =>
      callServerFn<CustomerSearchHit[]>(
        'searchCustomersByPhone',
        { phone: q },
        { tenantId },
      ),
  })
}

interface UpsertCustomerInput {
  id?: string
  name: string
  phone?: string | null
  email?: string | null
  notes?: string | null
}

interface UpsertCustomerResponse {
  id: string
  name: string
  phone: string | null
}

export function useUpsertCustomer() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertCustomerInput) =>
      callServerFn<UpsertCustomerResponse>('upsertCustomer', input, {
        tenantId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos', 'customer-search'] })
    },
  })
}

// ─── Loyalty summary ────────────────────────────────────────────────

export interface LoyaltyMovement {
  id: string
  type: string
  points: number
  saleId: string | null
  reason: string | null
  createdAt: string
}

export interface LoyaltySummary {
  pointsBalance: number
  lifetimeEarned: number
  lifetimeRedeemed: number
  movements: LoyaltyMovement[]
}

export function useCustomerLoyalty(customerId: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'loyalty-summary', tenantId, customerId],
    enabled: !!tenantId && !!customerId,
    staleTime: 30 * 1000,
    queryFn: () =>
      callServerFn<LoyaltySummary>(
        'getCustomerLoyaltySummary',
        { customerId },
        { tenantId },
      ),
  })
}

// ─── Stamp cards ────────────────────────────────────────────────────

export interface StampCardSummary {
  programId: string
  programName: string
  scope: string
  categoryId: string | null
  productId: string | null
  stampsRequired: number
  rewardMode: 'single' | 'bundle'
  rewardItemId: string | null
  rewardItemName: string | null
  imageUrl: string | null
  bundleRewards: Array<{
    itemId: string
    itemName: string
    quantity: number
  }>
  setItemIds: string[]
  currentStamps: number
  lifetimeStamps: number
  lifetimeRewards: number
  canRedeem: boolean
}

export function useCustomerStampCards(customerId: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'stamp-cards', tenantId, customerId],
    enabled: !!tenantId && !!customerId,
    staleTime: 30 * 1000,
    queryFn: () =>
      callServerFn<StampCardSummary[]>(
        'getCustomerStampCards',
        { customerId },
        { tenantId },
      ),
  })
}

// ─── POS settings (loyalty earn/redeem rates) ───────────────────────

export interface PosSettingsResponse {
  tier: string
  settings: {
    loyaltyEnabled: boolean
    loyaltyEarnMode: string
    loyaltyEarnRate: string
    loyaltyEarnStepAmount: string
    loyaltyEarnStepPoints: string
    loyaltyRedeemRate: string
  } | null
  limits: { features: string[] }
}

export function usePosSettings() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'settings', tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      callServerFn<PosSettingsResponse>('getPOSSettings', {}, { tenantId }),
  })
}

/**
 * Cap the number of points a customer can redeem on a given cart.
 * Server enforces the same rule; this is just so the slider/preview
 * agrees with the eventual submit.
 *
 *   redeemPoints * redeemRate ≤ subtotal
 *   → redeemPoints ≤ subtotal / redeemRate
 *
 * Then clamp to the customer's current balance, then floor to an integer.
 */
export function maxRedeemablePoints(
  subtotal: number,
  pointsBalance: number,
  redeemRate: number,
): number {
  if (redeemRate <= 0 || subtotal <= 0 || pointsBalance <= 0) return 0
  return Math.max(0, Math.floor(Math.min(subtotal / redeemRate, pointsBalance)))
}
