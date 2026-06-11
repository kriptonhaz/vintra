/**
 * Checkout — single screen with three sections:
 *   1. Cart summary (read-only; edits happen back on the catalog)
 *   2. Payment method picker (Cash / QRIS / Transfer for v1)
 *   3. Cash-only "Bayar berapa" input with auto-change calculator
 *
 * Submit fires createSale → on success, navigate to /pos/success/<id>.
 * Failure: show inline error (server returns Indonesian messages
 * already, e.g. "Saldo kredit tidak cukup", "Cabang tidak valid").
 */
import { useMemo, useState } from 'react'
import { useRouter, Stack } from 'expo-router'
import { Pressable } from 'react-native'
import {
  AlertTriangle,
  Banknote,
  CreditCard,
  Phone,
  Plus,
  QrCode,
  Sparkles,
  Stamp,
  User,
  Wallet,
  X,
} from '~/lib/icons'
import {
  Button,
  Card,
  H4,
  Input,
  Paragraph,
  ScrollView,
  Separator,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import { useCart } from '../../lib/cart-context'
import { useCashierMasters, useCreateSale, type PosPaymentMethod } from '../../lib/pos'
import {
  useCustomerLoyalty,
  useCustomerStampCards,
  usePosSettings,
  maxRedeemablePoints,
} from '../../lib/customers'
import { useActivePromotions, computeAutoPromos } from '../../lib/promos'
import { CustomerPickerSheet } from '../../components/pos/CustomerPickerSheet'
import { formatRupiah, parseRupiah } from '../../lib/currency'

// V1 surface — three options. Server supports more (card, ewallet,
// gopay, shopeepay, ovo) but we don't expose them yet to keep the
// picker simple. Easy to expand later.
const MOBILE_PAYMENT_METHODS: ReadonlyArray<{
  key: PosPaymentMethod
  label: string
  icon: typeof Banknote
}> = [
  { key: 'cash', label: 'Tunai', icon: Banknote },
  { key: 'qris', label: 'QRIS', icon: QrCode },
  { key: 'transfer', label: 'Transfer', icon: CreditCard },
]

export default function CheckoutScreen() {
  const cart = useCart()
  const masters = useCashierMasters()
  const createSale = useCreateSale()
  const router = useRouter()

  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('cash')
  const [paidInput, setPaidInput] = useState('')
  const [customerSheetOpen, setCustomerSheetOpen] = useState(false)

  // Loyalty + stamp data. Both server fns silently return nothing when
  // the tenant's tier lacks `loyalty_points`, so we can call them
  // unconditionally and let the section gate render based on settings.
  const settings = usePosSettings()
  const loyaltyEnabled = !!(
    settings.data?.limits.features.includes('loyalty_points') &&
    settings.data?.settings?.loyaltyEnabled
  )
  const redeemRate = Number(settings.data?.settings?.loyaltyRedeemRate ?? 0)
  const loyalty = useCustomerLoyalty(cart.customer?.id ?? null)
  const stampCards = useCustomerStampCards(cart.customer?.id ?? null)

  const redeemDiscount = useMemo(
    () => (loyaltyEnabled ? cart.redeemPoints * redeemRate : 0),
    [loyaltyEnabled, cart.redeemPoints, redeemRate],
  )

  // Auto-promo preview. Mirrors server-side resolution per line; we
  // subtract from the gross subtotal before applying loyalty redeem so
  // the cashier sees what createSale will actually charge.
  const promos = useActivePromotions()
  const autoPromo = useMemo(
    () =>
      computeAutoPromos(
        cart.lines.map((l) => ({
          itemId: l.itemId,
          categoryId: l.categoryId,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
        promos.data ?? [],
      ),
    [cart.lines, promos.data],
  )

  // Effective amount the customer owes. Server is the source of truth
  // for stamp-reward line discounts; for stamp rewards the cashier
  // currently has to add the free item to the cart (server validates
  // and zeros it out at createSale). Order matches the server chain:
  // gross subtotal − auto promo − redeem.
  const grandTotal = Math.max(
    0,
    cart.subtotal - autoPromo.totalDiscount - redeemDiscount,
  )

  // Cash only: paid amount must be >= total. Non-cash methods we
  // assume exact (paidAmount = total) — common convention for
  // QRIS / transfer.
  const paidAmount =
    paymentMethod === 'cash' ? parseRupiah(paidInput) : grandTotal
  const change = Math.max(0, paidAmount - grandTotal)
  const cashShortfall =
    paymentMethod === 'cash' && paidAmount < grandTotal

  const branchId = masters.data?.branches[0]?.id ?? ''
  const canSubmit =
    cart.lines.length > 0 &&
    branchId.length > 0 &&
    !createSale.isPending &&
    !cashShortfall

  async function handleSubmit() {
    if (!canSubmit) return
    try {
      const res = await createSale.mutateAsync({
        branchId,
        lines: cart.toSaleLines(),
        paymentMethod,
        paidAmount,
        customerName: cart.customer?.name ?? null,
        customerPhone: cart.customer?.phone ?? null,
        redeemPoints: cart.redeemPoints > 0 ? cart.redeemPoints : null,
        stampRedemptions:
          cart.stampRedemptions.length > 0 ? cart.stampRedemptions : null,
      })
      cart.clear()
      router.replace({
        pathname: '/pos/success/[id]',
        params: { id: res.id, saleNumber: res.saleNumber, total: String(res.total) },
      })
    } catch {
      // Error string is exposed below via createSale.error
    }
  }

  if (cart.lines.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title: 'Checkout' }} />
        <YStack flex={1} ai="center" jc="center" p="$6" gap="$3">
          <Wallet size={48} color="$color9" />
          <H4>Keranjang kosong</H4>
          <Paragraph ta="center" col="$color10">
            Tambah item dari halaman POS dulu.
          </Paragraph>
          <Button size="$4" onPress={() => router.back()}>
            Kembali
          </Button>
        </YStack>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Checkout' }} />
      <YStack flex={1} bg="$background">
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}>
          {/* Cart summary */}
          <Card bordered padded gap="$2">
            <Paragraph fontSize="$1" col="$color9" fontWeight="600">
              KERANJANG ({cart.itemCount} item)
            </Paragraph>
            <YStack gap="$1.5" pt="$2">
              {cart.lines.map((l) => (
                <XStack key={`${l.itemId}-${l.unitId}`} jc="space-between">
                  <Paragraph flex={1} numberOfLines={1}>
                    {l.qty}× {l.name}
                  </Paragraph>
                  <Paragraph fontWeight="600">
                    {formatRupiah(l.qty * l.unitPrice)}
                  </Paragraph>
                </XStack>
              ))}
            </YStack>
            <Separator />
            <XStack jc="space-between">
              <Paragraph>Subtotal</Paragraph>
              <Paragraph fontWeight="600">
                {formatRupiah(cart.subtotal)}
              </Paragraph>
            </XStack>
            {autoPromo.perPromo.map((p) => (
              <XStack jc="space-between" key={p.id}>
                <Paragraph col="$green11" numberOfLines={1} flex={1}>
                  Promo · {p.name}
                </Paragraph>
                <Paragraph fontWeight="600" col="$green11">
                  −{formatRupiah(p.amount)}
                </Paragraph>
              </XStack>
            ))}
            {redeemDiscount > 0 && (
              <XStack jc="space-between">
                <Paragraph col="$green11">
                  Tukar {cart.redeemPoints} poin
                </Paragraph>
                <Paragraph fontWeight="600" col="$green11">
                  −{formatRupiah(redeemDiscount)}
                </Paragraph>
              </XStack>
            )}
            <Separator />
            <XStack jc="space-between">
              <Paragraph fontWeight="700">Total</Paragraph>
              <Paragraph fontSize="$5" fontWeight="700">
                {formatRupiah(grandTotal)}
              </Paragraph>
            </XStack>
          </Card>

          {/* Customer pill — tap to open picker. Once attached, shows
              name + phone with a clear-X. */}
          <YStack gap="$2">
            <Paragraph fontSize="$1" col="$color9" fontWeight="600">
              PELANGGAN
            </Paragraph>
            {cart.customer ? (
              <Card bordered padded>
                <XStack ai="center" gap="$3">
                  <YStack
                    w={36}
                    h={36}
                    ai="center"
                    jc="center"
                    br="$10"
                    bg="$green3"
                  >
                    <User size={18} color="$green10" />
                  </YStack>
                  <YStack flex={1}>
                    <Paragraph fontWeight="600">{cart.customer.name}</Paragraph>
                    {cart.customer.phone && (
                      <XStack ai="center" gap="$1.5">
                        <Phone size={11} color="$color9" />
                        <Paragraph fontSize="$2" col="$color10">
                          +{cart.customer.phone}
                        </Paragraph>
                      </XStack>
                    )}
                  </YStack>
                  <Pressable
                    onPress={() => cart.setCustomer(null)}
                    hitSlop={10}
                  >
                    <X size={18} color="$color10" />
                  </Pressable>
                </XStack>
              </Card>
            ) : (
              <Pressable onPress={() => setCustomerSheetOpen(true)}>
                <Card bordered padded>
                  <XStack ai="center" gap="$2" jc="center">
                    <Plus size={16} color="$color9" />
                    <Paragraph col="$color10">Tambah Pelanggan</Paragraph>
                  </XStack>
                </Card>
              </Pressable>
            )}
          </YStack>

          {/* Loyalty + stamps. Visible only when tenant has loyalty
              feature AND a customer is attached. */}
          {loyaltyEnabled && cart.customer && (
            <LoyaltyStampsCard
              pointsBalance={loyalty.data?.pointsBalance ?? 0}
              redeemPoints={cart.redeemPoints}
              setRedeemPoints={cart.setRedeemPoints}
              subtotal={cart.subtotal}
              redeemRate={redeemRate}
              stampCards={stampCards.data ?? []}
              selectedStamps={cart.stampRedemptions}
              toggleStamp={cart.toggleStampRedemption}
            />
          )}

          {/* Payment method */}
          <YStack gap="$2">
            <Paragraph fontSize="$1" col="$color9" fontWeight="600">
              METODE PEMBAYARAN
            </Paragraph>
            <XStack gap="$2">
              {MOBILE_PAYMENT_METHODS.map(({ key, label, icon: Icon }) => {
                const active = paymentMethod === key
                return (
                  <Pressable
                    key={key}
                    onPress={() => setPaymentMethod(key)}
                    style={{ flex: 1 }}
                  >
                    <Card
                      bordered
                      padded
                      ai="center"
                      gap="$1"
                      bg={active ? '$green2' : '$background'}
                      borderColor={active ? '$green8' : '$borderColor'}
                    >
                      <Icon size={24} color={active ? '$green10' : '$color9'} />
                      <Paragraph fontWeight={active ? '700' : '500'}>
                        {label}
                      </Paragraph>
                    </Card>
                  </Pressable>
                )
              })}
            </XStack>
          </YStack>

          {/* Cash calculator (only for cash) */}
          {paymentMethod === 'cash' && (
            <YStack gap="$2">
              <Paragraph fontSize="$1" col="$color9" fontWeight="600">
                UANG DITERIMA
              </Paragraph>
              <Input
                value={paidInput}
                onChangeText={setPaidInput}
                keyboardType="numeric"
                placeholder="0"
                size="$5"
                ta="right"
                fontSize="$6"
                fontWeight="700"
              />
              {paidAmount > 0 && (
                <XStack jc="space-between" px="$2">
                  <Paragraph col="$color10">Kembalian</Paragraph>
                  <Paragraph
                    fontWeight="700"
                    col={cashShortfall ? '$red10' : '$green11'}
                  >
                    {cashShortfall
                      ? `Kurang ${formatRupiah(grandTotal - paidAmount)}`
                      : formatRupiah(change)}
                  </Paragraph>
                </XStack>
              )}
              <QuickAmountRow
                total={grandTotal}
                onPick={(v) => setPaidInput(String(v))}
              />
            </YStack>
          )}

          {/* Non-cash note */}
          {paymentMethod !== 'cash' && (
            <Card bordered padded gap="$1" bg="$gray2">
              <Paragraph fontSize="$2" col="$color11">
                Pastikan pelanggan sudah membayar penuh{' '}
                <Paragraph fontWeight="700">{formatRupiah(grandTotal)}</Paragraph>{' '}
                via {MOBILE_PAYMENT_METHODS.find((m) => m.key === paymentMethod)?.label}{' '}
                sebelum konfirmasi.
              </Paragraph>
            </Card>
          )}

          {/* Server error */}
          {createSale.error && (
            <Card bordered padded gap="$2" bg="$red2" borderColor="$red8">
              <XStack ai="center" gap="$2">
                <AlertTriangle size={16} color="$red10" />
                <H4 fontSize="$3" col="$red11">
                  Gagal kirim
                </H4>
              </XStack>
              <Paragraph fontSize="$2" col="$color11">
                {(createSale.error as Error).message ||
                  'Terjadi kesalahan. Coba lagi.'}
              </Paragraph>
            </Card>
          )}
        </ScrollView>

        {/* Sticky submit */}
        <YStack p="$3" borderTopWidth={1} borderTopColor="$borderColor" bg="$background">
          <Button
            size="$5"
            bg="#006b32" color="white" borderWidth={0}
            disabled={!canSubmit}
            onPress={handleSubmit}
          >
            {createSale.isPending ? (
              <Spinner />
            ) : (
              `Konfirmasi & Bayar ${formatRupiah(grandTotal)}`
            )}
          </Button>
        </YStack>
      </YStack>

      <CustomerPickerSheet
        open={customerSheetOpen}
        onClose={() => setCustomerSheetOpen(false)}
        onPick={(c) => cart.setCustomer(c)}
      />
    </>
  )
}

/**
 * Quick "uang pas + common notes" buttons — typing 50000 every time is
 * tedious. Shows the exact amount + the next 2-3 common Indonesian
 * banknotes above the total (20k, 50k, 100k).
 */
function QuickAmountRow({
  total,
  onPick,
}: {
  total: number
  onPick: (value: number) => void
}) {
  const buttons = buildQuickAmounts(total)
  return (
    <XStack gap="$2" mt="$1" flexWrap="wrap">
      {buttons.map((v) => (
        <Pressable key={v} onPress={() => onPick(v)} style={{ flexGrow: 1 }}>
          <YStack
            bg="$gray3"
            br="$3"
            px="$3"
            py="$2.5"
            ai="center"
          >
            <Paragraph fontWeight="600" fontSize="$2">
              {v === total ? 'Uang Pas' : formatRupiah(v)}
            </Paragraph>
          </YStack>
        </Pressable>
      ))}
    </XStack>
  )
}

function buildQuickAmounts(total: number): number[] {
  // Always include exact-amount. Add 20k/50k/100k denominations
  // strictly larger than the total — practical for typical warung sales.
  const notes = [20_000, 50_000, 100_000]
  const candidates = notes.filter((n) => n > total)
  // Always include the next round-up to nearest 10k if it would round
  // up by less than 5k (e.g. total 47k → suggest 50k).
  const roundUp = Math.ceil(total / 10_000) * 10_000
  if (roundUp > total && roundUp - total <= 5_000 && !candidates.includes(roundUp)) {
    candidates.unshift(roundUp)
  }
  return [total, ...candidates.slice(0, 3)]
}

/**
 * Loyalty + stamps section. Only renders when the tenant has the
 * loyalty_points feature on AND a customer is attached. Quick-pick
 * point buttons (25/50/100/max) instead of a slider — phone-friendly,
 * matches the "uang pas" pattern above.
 */
function LoyaltyStampsCard({
  pointsBalance,
  redeemPoints,
  setRedeemPoints,
  subtotal,
  redeemRate,
  stampCards,
  selectedStamps,
  toggleStamp,
}: {
  pointsBalance: number
  redeemPoints: number
  setRedeemPoints: (n: number) => void
  subtotal: number
  redeemRate: number
  stampCards: ReadonlyArray<{
    programId: string
    programName: string
    currentStamps: number
    stampsRequired: number
    canRedeem: boolean
    rewardItemName: string | null
    rewardMode: 'single' | 'bundle'
  }>
  selectedStamps: string[]
  toggleStamp: (programId: string) => void
}) {
  const maxPts = maxRedeemablePoints(subtotal, pointsBalance, redeemRate)
  // Quick-pick steps capped to maxPts. 25 is a typical smallest unit
  // for points balances.
  const STEPS = [25, 50, 100, 250]
  const quickPicks = STEPS.filter((s) => s <= maxPts)
  const redeemableCards = stampCards.filter((c) => c.canRedeem)

  return (
    <Card bordered padded gap="$3">
      <XStack ai="center" gap="$2">
        <Sparkles size={16} color="$amber10" />
        <Paragraph fontSize="$3" fontWeight="700">
          Loyalty & Stempel
        </Paragraph>
      </XStack>

      {/* Points block */}
      <YStack gap="$2">
        <XStack jc="space-between" ai="center">
          <Paragraph fontSize="$2" col="$color10">
            Saldo poin
          </Paragraph>
          <Paragraph fontWeight="700">
            {pointsBalance.toLocaleString('id-ID')} poin
          </Paragraph>
        </XStack>
        {pointsBalance > 0 && maxPts > 0 && (
          <>
            <Paragraph fontSize="$1" col="$color9">
              Tukar poin jadi diskon (1 poin = {formatRupiah(redeemRate)})
            </Paragraph>
            <XStack gap="$1.5" flexWrap="wrap">
              {redeemPoints > 0 && (
                <Pressable onPress={() => setRedeemPoints(0)}>
                  <YStack
                    bg="$red3"
                    br="$3"
                    px="$2.5"
                    py="$2"
                    ai="center"
                  >
                    <Paragraph fontWeight="600" fontSize="$2" col="$red11">
                      Batal
                    </Paragraph>
                  </YStack>
                </Pressable>
              )}
              {quickPicks.map((n) => {
                const active = redeemPoints === n
                return (
                  <Pressable key={n} onPress={() => setRedeemPoints(n)}>
                    <YStack
                      bg={active ? '$green4' : '$gray3'}
                      borderColor={active ? '$green10' : 'transparent'}
                      borderWidth={1}
                      br="$3"
                      px="$2.5"
                      py="$2"
                      ai="center"
                    >
                      <Paragraph
                        fontWeight="600"
                        fontSize="$2"
                        col={active ? '$green11' : '$color11'}
                      >
                        {n}
                      </Paragraph>
                    </YStack>
                  </Pressable>
                )
              })}
              {maxPts > 0 && !quickPicks.includes(maxPts) && (
                <Pressable onPress={() => setRedeemPoints(maxPts)}>
                  <YStack
                    bg={redeemPoints === maxPts ? '$green4' : '$gray3'}
                    borderColor={
                      redeemPoints === maxPts ? '$green10' : 'transparent'
                    }
                    borderWidth={1}
                    br="$3"
                    px="$2.5"
                    py="$2"
                    ai="center"
                  >
                    <Paragraph
                      fontWeight="600"
                      fontSize="$2"
                      col={redeemPoints === maxPts ? '$green11' : '$color11'}
                    >
                      Max ({maxPts})
                    </Paragraph>
                  </YStack>
                </Pressable>
              )}
            </XStack>
          </>
        )}
      </YStack>

      {/* Stamp cards — only show ready-to-redeem ones to keep the
          checkout uncluttered. Progress cards live on the customer
          detail page on web. */}
      {redeemableCards.length > 0 && (
        <YStack gap="$2">
          <Separator />
          <Paragraph fontSize="$1" col="$color9">
            Kartu siap ditukar
          </Paragraph>
          {redeemableCards.map((c) => {
            const selected = selectedStamps.includes(c.programId)
            return (
              <Pressable key={c.programId} onPress={() => toggleStamp(c.programId)}>
                <XStack
                  ai="center"
                  gap="$3"
                  p="$2.5"
                  br="$3"
                  bg={selected ? '$green3' : '$gray2'}
                  borderColor={selected ? '$green10' : 'transparent'}
                  borderWidth={1}
                >
                  <Stamp
                    size={20}
                    color={selected ? '$green10' : '$amber10'}
                  />
                  <YStack flex={1}>
                    <Paragraph fontWeight="600">{c.programName}</Paragraph>
                    <Paragraph fontSize="$1" col="$color9">
                      Hadiah: gratis{' '}
                      {c.rewardMode === 'bundle'
                        ? 'paket hadiah'
                        : (c.rewardItemName ?? '—')}
                    </Paragraph>
                  </YStack>
                  {selected && (
                    <Paragraph fontSize="$1" fontWeight="700" col="$green11">
                      DITUKAR
                    </Paragraph>
                  )}
                </XStack>
              </Pressable>
            )
          })}
          {selectedStamps.length > 0 && (
            <Paragraph fontSize="$1" col="$color9">
              Tambahkan item hadiah ke keranjang sebelum konfirmasi.
            </Paragraph>
          )}
        </YStack>
      )}
    </Card>
  )
}
