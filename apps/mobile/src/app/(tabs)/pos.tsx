/**
 * Kasir (POS) tab — catalog + search + category filter + cart.
 *
 * Layout (design-system styled):
 *   - Safe-area header: search pill + horizontal category chips.
 *   - 2-column product grid (fixed-width tiles so a lone last item stays
 *     half-width), each with its photo, name, stock, price, and an inline
 *     qty stepper. Infinite scroll loads more pages on scroll-end.
 *   - Floating cart bar (item count + total + Bayar) once the cart has
 *     items; tap the count area to review in the cart sheet.
 */
import { useState } from 'react'
import { useRouter } from 'expo-router'
import {
  FlatList,
  Image as RNImage,
  Pressable,
  TextInput,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Button,
  Card,
  H1,
  Paragraph,
  ScrollView,
  Separator,
  Sheet,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import {
  ImageOff,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Wallet,
  X,
} from '~/lib/icons'
import { useCart } from '../../lib/cart-context'
import { useOutlet } from '../../lib/outlet-context'
import {
  useCashierMasters,
  useInfiniteProducts,
  pickDefaultPricing,
  type PosProduct,
} from '../../lib/pos'
import { useActiveCashSession } from '../../lib/pos-cash'
import { PetiKasSheet } from '../../components/pos/PetiKasSheet'
import { formatRupiah } from '../../lib/currency'
import { COLORS, FONTS, SHADOWS } from '../../lib/theme'

const H_PADDING = 16
const GAP = 12

export default function PosTab() {
  return <PosScreen />
}

function PosScreen() {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const router = useRouter()
  const cart = useCart()

  const masters = useCashierMasters()
  // Global outlet (see apps/mobile/src/lib/outlet-context.tsx) drives
  // every branch-aware screen. If the user picked an outlet that has
  // no POS row in masters.branches (POS disabled for that branch),
  // surface an empty state below instead of silently falling back.
  const { selectedBranchId } = useOutlet()
  const branchId = selectedBranchId ?? ''
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [petiKasOpen, setPetiKasOpen] = useState(false)

  // Peti Kas (cash session) — only on Komplit + drawer enabled.
  const cashDrawerEnabled = masters.data?.cashDrawer?.enabled ?? false
  const cashSession = useActiveCashSession(branchId, cashDrawerEnabled)
  const openSession = cashSession.data?.session ?? null

  const tileWidth = (width - H_PADDING * 2 - GAP) / 2

  const products = useInfiniteProducts({
    branchId,
    search: search.trim() || undefined,
    categoryId: categoryId ?? undefined,
  })
  const items = products.data?.pages.flatMap((p) => p.items) ?? []

  if (masters.isLoading) {
    return (
      <Centered>
        <Spinner size="large" color={COLORS.primary} />
      </Centered>
    )
  }
  if (!masters.data || masters.data.branches.length === 0) {
    return (
      <EmptyState
        title="Cabang belum dibuat"
        body="Owner perlu menambah minimal satu cabang aktif sebelum POS bisa dipakai."
      />
    )
  }
  // The outlet switcher can land us on a branch where POS isn't enabled
  // (e.g. inventory-only outlet). masters.branches is the POS-enabled
  // subset, so a missing branchId here means "switch outlet to use POS".
  const posBranchOk =
    !!branchId && masters.data.branches.some((b) => b.id === branchId)
  if (!posBranchOk) {
    return (
      <EmptyState
        title="POS belum aktif di outlet ini"
        body="Pilih outlet lain dari header Beranda, atau aktifkan POS untuk outlet ini di pengaturan."
      />
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      {/* Header — safe-area top so it isn't tucked under the status bar */}
      <YStack
        bg={COLORS.surfaceContainerLowest}
        pt={insets.top + 8}
        px="$4"
        pb="$3"
        gap="$3"
        borderBottomWidth={1}
        borderBottomColor={COLORS.borderSubtle}
      >
        {/* Search + Peti Kas in one row. The Peti Kas button is icon-only
            to keep the header compact; the open-session expected cash
            shows inside the sheet after tap. Tinting the bg makes the
            "open vs closed" state visible at a glance even without text. */}
        <XStack ai="center" gap="$2">
          <XStack
            ai="center"
            gap="$2"
            h={44}
            px="$3.5"
            br={9999}
            bg={COLORS.surfaceContainerLow}
            flex={1}
          >
            <Search size={18} color={COLORS.outline} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Cari produk..."
              placeholderTextColor={COLORS.outline}
              style={{
                flex: 1,
                padding: 0,
                fontFamily: FONTS.body,
                fontSize: 14,
                color: COLORS.onSurface,
              }}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <X size={16} color={COLORS.outline} />
              </Pressable>
            )}
          </XStack>

          {cashDrawerEnabled && (
            <Pressable
              onPress={() => setPetiKasOpen(true)}
              accessibilityLabel={openSession ? 'Peti Kas' : 'Buka Kasir'}
            >
              <XStack
                ai="center"
                jc="center"
                w={44}
                h={44}
                br={9999}
                bg={openSession ? COLORS.primaryFixed : COLORS.secondaryContainer}
              >
                <Wallet
                  size={20}
                  color={openSession ? COLORS.primary : 'white'}
                />
              </XStack>
            </Pressable>
          )}
        </XStack>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          <CategoryChip
            label="Semua"
            active={categoryId === null}
            onPress={() => setCategoryId(null)}
          />
          {masters.data.categories.map((c) => (
            <CategoryChip
              key={c.id}
              label={c.name}
              active={categoryId === c.id}
              onPress={() => setCategoryId(c.id)}
            />
          ))}
        </ScrollView>
      </YStack>

      {/* Product grid */}
      {products.isLoading ? (
        <Centered>
          <Spinner color={COLORS.primary} />
        </Centered>
      ) : items.length === 0 ? (
        <EmptyState
          title="Tidak ada produk"
          body={
            search
              ? `Tidak ada produk yang cocok dengan "${search}".`
              : 'Owner perlu menambah produk + harga di modul Inventaris dulu.'
          }
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{
            padding: H_PADDING,
            gap: GAP,
            paddingBottom: cart.itemCount > 0 ? 112 : 24,
          }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ProductCard product={item} width={tileWidth} />
          )}
          onEndReached={() => {
            if (products.hasNextPage && !products.isFetchingNextPage) {
              void products.fetchNextPage()
            }
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            products.isFetchingNextPage ? (
              <YStack py="$3" ai="center">
                <Spinner color={COLORS.primary} />
              </YStack>
            ) : null
          }
        />
      )}

      {/* Floating cart bar */}
      {cart.itemCount > 0 && (
        <XStack
          pos="absolute"
          b="$3"
          l="$4"
          r="$4"
          bg={COLORS.primary}
          br={18}
          p="$2.5"
          ai="center"
          jc="space-between"
          style={SHADOWS.floating}
        >
          <Pressable onPress={() => setCartOpen(true)} style={{ flex: 1 }}>
            <XStack ai="center" gap="$2.5">
              <YStack
                w={40}
                h={40}
                br={12}
                bg="rgba(255,255,255,0.18)"
                ai="center"
                jc="center"
              >
                <ShoppingCart size={20} color="white" />
              </YStack>
              <YStack>
                <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="white">
                  {cart.itemCount} item
                </Paragraph>
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={12}
                  color="white"
                  opacity={0.85}
                >
                  {formatRupiah(cart.subtotal)}
                </Paragraph>
              </YStack>
            </XStack>
          </Pressable>
          <Pressable onPress={() => router.push('/pos/checkout')}>
            <YStack bg="white" br={9999} px="$4" h={40} ai="center" jc="center">
              <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color={COLORS.primary}>
                Bayar
              </Paragraph>
            </YStack>
          </Pressable>
        </XStack>
      )}

      <CartSheet open={cartOpen} onClose={() => setCartOpen(false)} />

      {cashDrawerEnabled && (
        <PetiKasSheet
          open={petiKasOpen}
          onClose={() => setPetiKasOpen(false)}
          branchId={branchId}
        />
      )}
    </YStack>
  )
}

// ─── Product card ────────────────────────────────────────────────────

function ProductCard({
  product,
  width,
}: {
  product: PosProduct
  width: number
}) {
  const cart = useCart()
  const pricing = pickDefaultPricing(product)
  const unitId = pricing?.unit.unitId
  const price = pricing?.tier.unitPrice ?? 0
  const unitLabel = pricing?.unit.unitLabel ?? product.baseUnitLabel

  const line = unitId
    ? cart.lines.find((l) => l.itemId === product.id && l.unitId === unitId)
    : undefined
  const qty = line?.qty ?? 0

  const outOfStock =
    !product.recipeBacked && product.stockInBase <= 0 && !product.prepMode
  const prepEmpty = product.prepMode && (product.siapInBase ?? 0) <= 0
  const disabled = !pricing || outOfStock || prepEmpty

  const stockLabel = product.recipeBacked
    ? product.prepMode
      ? `Siap: ${product.siapInBase ?? 0}`
      : 'Auto'
    : `Stok: ${product.stockInBase} ${product.baseUnitLabel}`

  const selected = qty > 0
  const empty = outOfStock || prepEmpty

  // Whole-card tap increments the qty (decrease happens in the cart
  // sheet). A selected card gets a secondary-color (Action Orange)
  // border + a qty badge. Out-of-stock items dim and carry a diagonal
  // "KOSONG" corner ribbon (the card's overflow:hidden clips the rotated
  // banner into a corner triangle); the ribbon sits outside the dimmed
  // content so it stays vivid.
  return (
    <Pressable
      onPress={disabled ? undefined : () => cart.addProduct(product)}
      style={{ width }}
    >
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={16}
        borderWidth={selected ? 2 : 1}
        borderColor={selected ? COLORS.secondaryContainer : COLORS.borderSubtle}
        overflow="hidden"
      >
        <YStack opacity={empty ? 0.45 : 1}>
          <ProductImage uri={product.photoUrl} height={width * 0.8} />

          <YStack p="$3" gap="$1.5">
            <YStack minHeight={40} gap={1}>
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={14}
                lineHeight={18}
                color={COLORS.onSurface}
                numberOfLines={2}
              >
                {product.name}
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
                numberOfLines={1}
              >
                {stockLabel}
              </Paragraph>
            </YStack>

            <YStack>
              <Paragraph
                fontFamily={FONTS.headingBold}
                fontSize={15}
                color={COLORS.primary}
              >
                {formatRupiah(price)}
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={10}
                color={COLORS.onSurfaceVariant}
              >
                per {unitLabel}
              </Paragraph>
            </YStack>
          </YStack>
        </YStack>

        {selected && (
          <YStack
            pos="absolute"
            t={8}
            r={8}
            minWidth={24}
            h={24}
            br={12}
            px={7}
            bg={COLORS.secondaryContainer}
            ai="center"
            jc="center"
          >
            <Paragraph fontFamily={FONTS.bodyBold} fontSize={12} color="white">
              {qty}
            </Paragraph>
          </YStack>
        )}

        {empty && (
          <YStack
            pos="absolute"
            t={16}
            r={-38}
            w={140}
            py={3}
            bg={COLORS.secondaryContainer}
            ai="center"
            jc="center"
            pointerEvents="none"
            style={{ transform: [{ rotate: '45deg' }] }}
          >
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={10}
              color="white"
              letterSpacing={1}
            >
              KOSONG
            </Paragraph>
          </YStack>
        )}
      </YStack>
    </Pressable>
  )
}

/**
 * Product thumbnail. Uses `contain` on a white tile so the whole product
 * is visible (matches the web catalog) rather than being cropped/zoomed
 * by `cover`. Falls back to a placeholder when there's no photo or the
 * signed URL fails to load.
 */
function ProductImage({ uri, height }: { uri: string | null; height: number }) {
  const [failed, setFailed] = useState(false)
  if (!uri || failed) {
    return (
      <YStack height={height} bg={COLORS.surfaceContainerLow} ai="center" jc="center">
        <ImageOff size={28} color={COLORS.outlineVariant} />
      </YStack>
    )
  }
  return (
    <YStack height={height} bg="white" ai="center" jc="center" p="$2">
      <RNImage
        source={{ uri }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
    </YStack>
  )
}

function StepBtn({
  icon,
  tint,
  onPress,
}: {
  icon: React.ReactNode
  tint: string
  onPress?: () => void
}) {
  return (
    <Pressable onPress={onPress}>
      <YStack w={30} h={30} br={10} bg={tint} ai="center" jc="center">
        {icon}
      </YStack>
    </Pressable>
  )
}

// ─── Category chip ───────────────────────────────────────────────────

function CategoryChip({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress}>
      <YStack
        px="$3.5"
        py="$2"
        br={9999}
        bg={active ? COLORS.primary : COLORS.surfaceContainerLow}
      >
        <Paragraph
          fontFamily={FONTS.bodySemi}
          fontSize={13}
          color={active ? 'white' : COLORS.onSurfaceVariant}
        >
          {label}
        </Paragraph>
      </YStack>
    </Pressable>
  )
}

// ─── Cart sheet ──────────────────────────────────────────────────────

function CartSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cart = useCart()
  const router = useRouter()

  function handleCheckout() {
    onClose()
    router.push('/pos/checkout')
  }

  return (
    <Sheet open={open} onOpenChange={onClose} snapPoints={[85]} modal>
      <Sheet.Overlay />
      <Sheet.Frame padding="$4" gap="$3" bg={COLORS.background}>
        <Sheet.Handle />
        <XStack jc="space-between" ai="center">
          <H1 fontSize="$7" fontFamily={FONTS.headingBold} color={COLORS.onSurface}>
            Keranjang
          </H1>
          <Pressable onPress={onClose}>
            <YStack
              w={36}
              h={36}
              br={18}
              bg={COLORS.surfaceContainerHigh}
              ai="center"
              jc="center"
            >
              <X size={18} color={COLORS.onSurfaceVariant} />
            </YStack>
          </Pressable>
        </XStack>

        {cart.lines.length === 0 ? (
          <YStack flex={1} ai="center" jc="center" gap="$2">
            <ShoppingCart size={48} color={COLORS.outlineVariant} />
            <Paragraph color={COLORS.onSurfaceVariant} fontFamily={FONTS.body}>
              Keranjang masih kosong.
            </Paragraph>
          </YStack>
        ) : (
          <>
            <ScrollView showsVerticalScrollIndicator={false}>
              <YStack gap="$2">
                {cart.lines.map((line) => (
                  <Card
                    key={`${line.itemId}-${line.unitId}`}
                    bg={COLORS.surfaceContainerLowest}
                    bordered
                    borderColor={COLORS.borderSubtle}
                    padding="$3"
                    gap="$2"
                  >
                    <XStack jc="space-between" ai="center">
                      <YStack flex={1} gap="$0.5">
                        <Paragraph
                          fontFamily={FONTS.bodyBold}
                          color={COLORS.onSurface}
                          numberOfLines={2}
                        >
                          {line.name}
                        </Paragraph>
                        <Paragraph
                          fontSize="$2"
                          fontFamily={FONTS.body}
                          color={COLORS.onSurfaceVariant}
                        >
                          {formatRupiah(line.unitPrice)} / {line.unitLabel}
                        </Paragraph>
                      </YStack>
                      <Pressable
                        onPress={() => cart.removeLine(line.itemId, line.unitId)}
                      >
                        <YStack p="$1.5">
                          <Trash2 size={18} color={COLORS.danger} />
                        </YStack>
                      </Pressable>
                    </XStack>
                    <XStack jc="space-between" ai="center">
                      <XStack ai="center" gap="$2">
                        <StepBtn
                          icon={<Minus size={16} color={COLORS.primary} />}
                          tint={COLORS.primaryFixed}
                          onPress={() =>
                            cart.setQty(line.itemId, line.unitId, line.qty - 1)
                          }
                        />
                        <Paragraph
                          fontFamily={FONTS.bodyBold}
                          minWidth={28}
                          textAlign="center"
                          color={COLORS.onSurface}
                        >
                          {line.qty}
                        </Paragraph>
                        <StepBtn
                          icon={<Plus size={16} color="white" />}
                          tint={COLORS.primary}
                          onPress={() =>
                            cart.setQty(line.itemId, line.unitId, line.qty + 1)
                          }
                        />
                      </XStack>
                      <Paragraph
                        fontFamily={FONTS.bodyBold}
                        color={COLORS.onSurface}
                      >
                        {formatRupiah(line.qty * line.unitPrice)}
                      </Paragraph>
                    </XStack>
                  </Card>
                ))}
              </YStack>
            </ScrollView>

            <Separator borderColor={COLORS.borderSubtle} />
            <XStack jc="space-between" ai="center">
              <Paragraph fontSize="$4" fontFamily={FONTS.body} color={COLORS.onSurfaceVariant}>
                Total
              </Paragraph>
              <Paragraph fontSize="$6" fontFamily={FONTS.headingBold} color={COLORS.onSurface}>
                {formatRupiah(cart.subtotal)}
              </Paragraph>
            </XStack>
            <Button
              size="$5"
              bg={COLORS.primary}
              pressStyle={{ bg: COLORS.brandActive }}
              color="white"
              borderWidth={0}
              onPress={handleCheckout}
            >
              <Paragraph fontFamily={FONTS.bodyBold} fontSize={15} color="white">
                Lanjut Bayar
              </Paragraph>
            </Button>
          </>
        )}
      </Sheet.Frame>
    </Sheet>
  )
}

// ─── Shared ──────────────────────────────────────────────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <YStack flex={1} ai="center" jc="center" bg={COLORS.background}>
      {children}
    </YStack>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <YStack flex={1} ai="center" jc="center" p="$6" gap="$3" bg={COLORS.background}>
      <ShoppingCart size={48} color={COLORS.outlineVariant} />
      <Paragraph fontFamily={FONTS.headingBold} fontSize={18} color={COLORS.onSurface}>
        {title}
      </Paragraph>
      <Paragraph
        textAlign="center"
        fontFamily={FONTS.body}
        color={COLORS.onSurfaceVariant}
        maxWidth={280}
      >
        {body}
      </Paragraph>
    </YStack>
  )
}
