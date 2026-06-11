/**
 * Lainnya — module launcher + account. Gojek-style grid of tinted icon
 * tiles that surfaces every module not already pinned to its own bottom
 * tab (HPP, Cashflow, WhatsApp, Booking, Situs, Konten, Master Data,
 * Settings) plus the legacy account section (tenant switcher, sign out).
 *
 * Each tile renders only when the current member's permissions clear
 * the gate. For modules that don't have a mobile screen yet, tapping
 * opens the web equivalent on the tenant subdomain
 * (`https://<slug>.vintra.my.id/...`) — feature locks (Pro upsell) are
 * handled there so we don't duplicate billing logic on mobile.
 */
import { useRouter } from 'expo-router'
import { Alert, Linking, Pressable, ScrollView } from 'react-native'
import { Paragraph, XStack, YStack } from 'tamagui'
import {
  ArrowDownToLine,
  BarChart2,
  Bell,
  Briefcase,
  Building2,
  Calculator,
  Calendar,
  ChevronRight,
  CreditCard,
  Gift,
  Globe,
  HelpCircle,
  LogOut,
  Megaphone,
  MessageCircle,
  QrCode,
  Settings,
  Shield,
  Sparkles,
  Stamp,
  Tag,
  TrendingUp,
  Truck,
  User,
  Users,
  Wallet,
} from '~/lib/icons'
import { useAuth } from '../../lib/auth-context'
import { useTenant } from '../../lib/tenant-context'
import { COLORS, FONTS, SHADOWS } from '../../lib/theme'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Pemilik',
  admin: 'Admin',
  manager: 'Manajer',
  supervisor: 'Supervisor',
  cashier: 'Kasir',
  employee: 'Karyawan',
  staff: 'Staf',
  member: 'Anggota',
}

function roleLabel(role: string): string {
  const key = role.trim().toLowerCase()
  if (!key) return ''
  return ROLE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

// ─── Module catalog ──────────────────────────────────────────────────

interface ModuleTile {
  key: string
  label: string
  icon: React.ComponentType<{ size?: number; color?: string }>
  iconColor: string
  tint: string
  /** Required permission(s); user must have at least ONE. Empty = always shown. */
  permissions?: string[]
  /** Mobile route — if set, in-app navigation. Otherwise opens web URL. */
  mobileHref?: string
  /** Web path (joined with the tenant subdomain). */
  webPath: string
}

const MODULES: ModuleTile[] = [
  {
    key: 'hpp',
    label: 'HPP',
    icon: Calculator,
    iconColor: COLORS.primary,
    tint: COLORS.primaryFixed,
    permissions: ['hpp.read'],
    mobileHref: '/hpp',
    webPath: '/hpp',
  },
  {
    key: 'cashflow',
    label: 'Cashflow',
    icon: Wallet,
    iconColor: '#2563eb',
    tint: '#dbeafe',
    permissions: ['pos.read'],
    mobileHref: '/cashflow',
    webPath: '/cashflow',
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    iconColor: '#25D366',
    tint: '#dcfce7',
    permissions: ['whatsapp.read'],
    mobileHref: '/whatsapp',
    webPath: '/whatsapp/dashboard',
  },
  {
    key: 'booking',
    label: 'Booking',
    icon: Calendar,
    iconColor: '#a0364d',
    tint: '#ffd9dd',
    permissions: ['booking.read'],
    mobileHref: '/booking',
    webPath: '/booking',
  },
  {
    key: 'site',
    label: 'Situs',
    icon: Globe,
    iconColor: '#7c3aed',
    tint: '#ede9fe',
    permissions: ['booking.write'],
    mobileHref: '/site/edit',
    webPath: '/site/edit',
  },
  {
    key: 'konten',
    label: 'Konten',
    icon: Sparkles,
    iconColor: '#9a4600',
    tint: '#ffdbc9',
    permissions: ['pos.read'],
    mobileHref: '/studio',
    webPath: '/studio',
  },
  {
    key: 'z-report',
    label: 'Laporan Harian',
    icon: BarChart2,
    iconColor: '#2563eb',
    tint: '#dbeafe',
    permissions: ['pos.report.view'],
    mobileHref: '/pos/sales',
    webPath: '/pos/sales',
  },
]

// Attendance operations tiles — sub-screens of the Absensi module
// (owner / supervisor surface). The staff check-in flow stays on the
// bottom tab; these are management surfaces.
const ATTENDANCE_OPS: ModuleTile[] = [
  {
    key: 'att-shifts',
    label: 'Shift',
    icon: Calendar,
    iconColor: '#2563eb',
    tint: '#dbeafe',
    permissions: ['attendance.manage'],
    mobileHref: '/attendance/shifts',
    webPath: '/attendance/shifts',
  },
  {
    key: 'att-qr-host',
    label: 'QR Kiosk',
    icon: QrCode,
    iconColor: '#7c3aed',
    tint: '#ede9fe',
    permissions: ['attendance.manage'],
    mobileHref: '/attendance/qr-host',
    webPath: '/attendance/qr-host',
  },
  {
    key: 'att-settings',
    label: 'Pengaturan Absensi',
    icon: Settings,
    iconColor: '#6b7280',
    tint: '#f3f4f6',
    permissions: ['attendance.manage'],
    mobileHref: '/attendance/settings',
    webPath: '/attendance/settings',
  },
  {
    key: 'att-billing',
    label: 'Paket Absensi',
    icon: CreditCard,
    iconColor: '#9a4600',
    tint: '#ffdbc9',
    permissions: ['attendance.manage'],
    mobileHref: '/attendance/billing',
    webPath: '/attendance/billing',
  },
]

// Inventory operations tiles — sub-screens of the Inventaris module.
// Live in their own section so the launcher stays scannable.
const INVENTORY_OPS: ModuleTile[] = [
  {
    key: 'inv-movements',
    label: 'Pergerakan Stok',
    icon: TrendingUp,
    iconColor: '#2563eb',
    tint: '#dbeafe',
    permissions: ['inventory.read'],
    mobileHref: '/inventory/movements',
    webPath: '/inventory/movements',
  },
  {
    key: 'inv-po',
    label: 'Purchase Order',
    icon: Truck,
    iconColor: '#9a4600',
    tint: '#ffdbc9',
    permissions: ['inventory.manage'],
    mobileHref: '/inventory/po',
    webPath: '/inventory/po',
  },
  {
    key: 'inv-import',
    label: 'Import dari HPP',
    icon: ArrowDownToLine,
    iconColor: '#7c3aed',
    tint: '#ede9fe',
    permissions: ['inventory.manage'],
    mobileHref: '/inventory/items/import',
    webPath: '/inventory/items/import',
  },
  {
    key: 'inv-billing',
    label: 'Paket Inventaris',
    icon: CreditCard,
    iconColor: COLORS.primary,
    tint: COLORS.primaryFixed,
    mobileHref: '/inventory/billing',
    webPath: '/inventory/billing',
  },
]

// POS operations tiles — sub-screens of the Kasir module (admin /
// supervisor surface). Cashier-only members typically only see Peti
// Kas (and only if they have an open session anyway, handled inside
// the screen). All gates are server-enforced.
const POS_OPS: ModuleTile[] = [
  {
    key: 'pos-cash-sessions',
    label: 'Peti Kas',
    icon: Wallet,
    iconColor: COLORS.primary,
    tint: COLORS.primaryFixed,
    permissions: ['pos.read'],
    mobileHref: '/pos/cash-sessions',
    webPath: '/pos/cash-sessions',
  },
  {
    key: 'pos-promos',
    label: 'Promo',
    icon: Tag,
    iconColor: '#a0364d',
    tint: '#ffd9dd',
    permissions: ['pos.manage'],
    mobileHref: '/pos/promos',
    webPath: '/pos/promos',
  },
  {
    key: 'pos-loyalty',
    label: 'Loyalti',
    icon: Stamp,
    iconColor: '#7c3aed',
    tint: '#ede9fe',
    permissions: ['pos.manage'],
    mobileHref: '/pos/loyalty',
    webPath: '/pos/loyalty',
  },
  {
    key: 'pos-settings',
    label: 'Pengaturan Kasir',
    icon: Settings,
    iconColor: '#6b7280',
    tint: '#f3f4f6',
    permissions: ['pos.manage'],
    mobileHref: '/pos/settings',
    webPath: '/pos/settings',
  },
  {
    key: 'pos-prep-waste',
    label: 'Prep & Waste',
    icon: BarChart2,
    iconColor: '#2563eb',
    tint: '#dbeafe',
    permissions: ['pos.report.view'],
    mobileHref: '/pos/reports/prep-waste',
    webPath: '/pos/reports/prep-waste',
  },
  {
    key: 'pos-billing',
    label: 'Paket Kasir',
    icon: CreditCard,
    iconColor: '#9a4600',
    tint: '#ffdbc9',
    mobileHref: '/pos/billing',
    webPath: '/pos/billing',
  },
]

const MASTER_DATA: ModuleTile[] = [
  {
    key: 'branches',
    label: 'Cabang',
    icon: Building2,
    iconColor: COLORS.primary,
    tint: COLORS.primaryFixed,
    permissions: ['attendance.manage'],
    mobileHref: '/master/branches',
    webPath: '/master/branches',
  },
  {
    key: 'suppliers',
    label: 'Supplier',
    icon: Truck,
    iconColor: '#6b7280',
    tint: '#f3f4f6',
    permissions: ['hpp.read'],
    mobileHref: '/master/suppliers',
    webPath: '/master/suppliers',
  },
  {
    key: 'categories',
    label: 'Kategori',
    icon: Tag,
    iconColor: '#0891b2',
    tint: '#cffafe',
    permissions: ['hpp.read'],
    mobileHref: '/master/categories',
    webPath: '/master/categories',
  },
  {
    key: 'customers',
    label: 'Pelanggan',
    icon: Users,
    iconColor: '#7c3aed',
    tint: '#ede9fe',
    permissions: ['pos.read'],
    mobileHref: '/master/customers',
    webPath: '/master/customers',
  },
]

const SETTINGS_MODULES: ModuleTile[] = [
  {
    key: 'announcements',
    label: 'Pengumuman',
    icon: Megaphone,
    iconColor: '#9a4600',
    tint: '#ffdbc9',
    mobileHref: '/announcements',
    webPath: '/settings/announcements',
  },
  {
    key: 'announcements-admin',
    label: 'Kelola Pengumuman',
    icon: Megaphone,
    iconColor: '#a0364d',
    tint: '#ffd9dd',
    permissions: ['announcements.manage'],
    mobileHref: '/settings/announcements',
    webPath: '/settings/announcements',
  },
  {
    key: 'members',
    label: 'Tim',
    icon: Users,
    iconColor: COLORS.primary,
    tint: COLORS.primaryFixed,
    permissions: ['members.read'],
    mobileHref: '/settings/members',
    webPath: '/settings/members',
  },
  {
    key: 'roles',
    label: 'Peran',
    icon: Shield,
    iconColor: '#6b7280',
    tint: '#f3f4f6',
    permissions: ['settings.manage'],
    mobileHref: '/settings/roles',
    webPath: '/settings/roles',
  },
  {
    key: 'referral',
    label: 'Referral',
    icon: Gift,
    iconColor: '#a0364d',
    tint: '#ffd9dd',
    permissions: ['members.read'],
    mobileHref: '/referrals',
    webPath: '/referrals',
  },
  {
    key: 'notifications',
    label: 'Notifikasi',
    icon: Bell,
    iconColor: '#2563eb',
    tint: '#dbeafe',
    mobileHref: '/notifications',
    webPath: '/notifications',
  },
  {
    key: 'feedback',
    label: 'Bantuan',
    icon: HelpCircle,
    iconColor: COLORS.primary,
    tint: COLORS.primaryFixed,
    mobileHref: '/feedback',
    webPath: '/help/feedback',
  },
  {
    key: 'account',
    label: 'Akun',
    icon: Settings,
    iconColor: '#6b7280',
    tint: '#f3f4f6',
    mobileHref: '/settings/account',
    webPath: '/settings/account',
  },
]

// ─── Main view ───────────────────────────────────────────────────────

export default function LainnyaTab() {
  const { user, signOut } = useAuth()
  const { state, hasPermission, clear } = useTenant()
  const router = useRouter()

  const tenant = state.status === 'ready' ? state.tenant : null
  const tenants = state.status === 'ready' ? state.tenants : []
  const hasMultipleTenants = tenants.length > 1
  const slug = tenant?.slug ?? null

  function visibleTiles(tiles: ModuleTile[]): ModuleTile[] {
    return tiles.filter(
      (t) => !t.permissions || t.permissions.some((p) => hasPermission(p)),
    )
  }

  function onTilePress(tile: ModuleTile) {
    if (tile.mobileHref) {
      router.push(tile.mobileHref as never)
      return
    }
    const base = slug
      ? `https://${slug}.vintra.my.id`
      : 'https://vintra.my.id'
    const path = tile.webPath.startsWith('/') ? tile.webPath : `/${tile.webPath}`
    void Linking.openURL(`${base}${path}`)
  }

  function handleSignOut() {
    Alert.alert('Keluar dari akun?', 'Kamu akan diminta login lagi.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Keluar',
        style: 'destructive',
        onPress: async () => {
          await clear()
          await signOut()
        },
      },
    ])
  }

  const modules = visibleTiles(MODULES)
  const attendanceOps = visibleTiles(ATTENDANCE_OPS)
  const inventoryOps = visibleTiles(INVENTORY_OPS)
  const posOps = visibleTiles(POS_OPS)
  const master = visibleTiles(MASTER_DATA)
  const settings = visibleTiles(SETTINGS_MODULES)

  return (
    <YStack flex={1} bg={COLORS.background}>
      {/* HEADER — brand-green strip with a soft halo circle in the
          corner for visual interest (matches the playful Gojek-style
          launcher screen the redesign is inspired by). */}
      <YStack
        bg={COLORS.primary}
        pt={60}
        pb="$5"
        px="$5"
        gap="$1.5"
        overflow="hidden"
        position="relative"
      >
        <YStack
          position="absolute"
          top={-40}
          right={-40}
          w={160}
          h={160}
          br={9999}
          bg="rgba(255,255,255,0.07)"
        />
        <YStack
          position="absolute"
          top={20}
          right={40}
          w={70}
          h={70}
          br={9999}
          bg="rgba(255,255,255,0.05)"
        />
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={12}
          color="white"
          opacity={0.85}
        >
          Modul & Pengaturan
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.headingBold}
          fontSize={24}
          color="white"
        >
          Lainnya
        </Paragraph>
      </YStack>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Active tenant card */}
        {tenant && (
          <Pressable
            onPress={
              hasMultipleTenants ? () => router.push('/tenant-picker') : undefined
            }
            disabled={!hasMultipleTenants}
          >
            <YStack
              bg={COLORS.surfaceContainerLowest}
              br={18}
              p="$4"
              gap="$3"
              borderWidth={1}
              borderColor={COLORS.borderSubtle}
              style={SHADOWS.card}
            >
              <XStack ai="center" gap="$3">
                <YStack
                  w={44}
                  h={44}
                  br={14}
                  bg={COLORS.primaryFixed}
                  ai="center"
                  jc="center"
                >
                  <Briefcase size={20} color={COLORS.primary} />
                </YStack>
                <YStack flex={1} gap={2}>
                  <Paragraph
                    fontFamily={FONTS.bodySemi}
                    fontSize={11}
                    color={COLORS.onSurfaceVariant}
                    letterSpacing={0.4}
                  >
                    USAHA AKTIF
                  </Paragraph>
                  <Paragraph
                    fontFamily={FONTS.headingBold}
                    fontSize={16}
                    color={COLORS.onSurface}
                    numberOfLines={1}
                  >
                    {tenant.businessName}
                  </Paragraph>
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={11}
                    color={COLORS.onSurfaceVariant}
                  >
                    Peran: {roleLabel(tenant.role)}
                    {hasMultipleTenants ? ' · Ganti usaha' : ''}
                  </Paragraph>
                </YStack>
                {hasMultipleTenants && (
                  <ChevronRight size={18} color={COLORS.outline} />
                )}
              </XStack>
            </YStack>
          </Pressable>
        )}

        {/* Module grid */}
        {modules.length > 0 && (
          <Section title="Modul Usaha">
            <TileGrid tiles={modules} onPress={onTilePress} />
          </Section>
        )}

        {posOps.length > 0 && (
          <Section title="Kasir">
            <TileGrid tiles={posOps} onPress={onTilePress} />
          </Section>
        )}

        {inventoryOps.length > 0 && (
          <Section title="Inventaris">
            <TileGrid tiles={inventoryOps} onPress={onTilePress} />
          </Section>
        )}

        {attendanceOps.length > 0 && (
          <Section title="Absensi">
            <TileGrid tiles={attendanceOps} onPress={onTilePress} />
          </Section>
        )}

        {master.length > 0 && (
          <Section title="Data Master">
            <TileGrid tiles={master} onPress={onTilePress} />
          </Section>
        )}

        {settings.length > 0 && (
          <Section title="Pengaturan & Akun">
            <TileGrid tiles={settings} onPress={onTilePress} />
          </Section>
        )}

        {/* Account info */}
        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={18}
          p="$4"
          gap="$3"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
          style={SHADOWS.card}
        >
          <XStack ai="center" gap="$3">
            <YStack
              w={44}
              h={44}
              br={14}
              bg={COLORS.surfaceContainerLow}
              ai="center"
              jc="center"
            >
              <User size={20} color={COLORS.outline} />
            </YStack>
            <YStack flex={1} gap={2}>
              <Paragraph
                fontFamily={FONTS.bodySemi}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
                letterSpacing={0.4}
              >
                AKUN
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.bodyMedium}
                fontSize={14}
                color={COLORS.onSurface}
                numberOfLines={1}
              >
                {user?.email ?? '—'}
              </Paragraph>
            </YStack>
          </XStack>
        </YStack>

        {/* Sign out */}
        <Pressable onPress={handleSignOut}>
          <XStack
            ai="center"
            gap="$3"
            bg={COLORS.surfaceContainerLowest}
            br={18}
            p="$4"
            borderWidth={1}
            borderColor={COLORS.dangerTint}
          >
            <YStack
              w={40}
              h={40}
              br={12}
              bg={COLORS.dangerTint}
              ai="center"
              jc="center"
            >
              <LogOut size={18} color={COLORS.danger} />
            </YStack>
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={14}
              color={COLORS.danger}
            >
              Keluar dari akun
            </Paragraph>
          </XStack>
        </Pressable>
      </ScrollView>
    </YStack>
  )
}

// ─── Building blocks ─────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={20}
      p="$4"
      gap="$3.5"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={11}
        color={COLORS.onSurfaceVariant}
        letterSpacing={0.55}
        textTransform="uppercase"
      >
        {title}
      </Paragraph>
      {children}
    </YStack>
  )
}

function TileGrid({
  tiles,
  onPress,
}: {
  tiles: ModuleTile[]
  onPress: (tile: ModuleTile) => void
}) {
  // 4 columns. Build rows in groups of 4 so the trailing partial row
  // doesn't stretch — empty spacers keep widths consistent.
  const rows: ModuleTile[][] = []
  for (let i = 0; i < tiles.length; i += 4) {
    rows.push(tiles.slice(i, i + 4))
  }

  return (
    <YStack gap="$3">
      {rows.map((row, i) => (
        <XStack key={i} gap="$2">
          {row.map((tile) => (
            <ModuleTileButton key={tile.key} tile={tile} onPress={onPress} />
          ))}
          {Array.from({ length: 4 - row.length }).map((_, j) => (
            <YStack key={`spacer-${j}`} flex={1} />
          ))}
        </XStack>
      ))}
    </YStack>
  )
}

function ModuleTileButton({
  tile,
  onPress,
}: {
  tile: ModuleTile
  onPress: (tile: ModuleTile) => void
}) {
  const Icon = tile.icon

  return (
    <Pressable
      onPress={() => onPress(tile)}
      style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.65 : 1 })}
    >
      <YStack ai="center" gap="$2">
        <YStack
          w={56}
          h={56}
          br={18}
          bg={tile.tint}
          ai="center"
          jc="center"
          borderWidth={1}
          borderColor="rgba(255,255,255,0.6)"
          shadowColor={tile.iconColor}
          shadowOpacity={0.18}
          shadowRadius={8}
          shadowOffset={{ width: 0, height: 3 }}
          elevation={2}
        >
          <Icon size={24} color={tile.iconColor} />
        </YStack>
        <Paragraph
          fontFamily={FONTS.bodyMedium}
          fontSize={11}
          color={COLORS.onSurface}
          ta="center"
          numberOfLines={2}
        >
          {tile.label}
        </Paragraph>
      </YStack>
    </Pressable>
  )
}
