/**
 * Icon wrapper — re-exports the icons we use across the app as named
 * components, backed by @expo/vector-icons (Feather + MaterialCommunityIcons).
 *
 * Why this exists: we originally tried @tamagui/lucide-icons but they
 * silently failed to render on the iOS Dev Client (showed as red "U"
 * placeholders) — Tamagui's lucide bundle has a fragile dependency
 * on react-native-svg's auto-linking through the Expo prebuild that
 * never quite resolved cleanly in our monorepo. @expo/vector-icons
 * uses bundled font files that Expo loads automatically — zero
 * native config, works on first launch.
 *
 * Each export keeps the **same name as the Lucide icon** so call
 * sites change only the import path, not the JSX. Sizes + colors
 * accept the same React Native style conventions.
 *
 * If you need an icon that isn't here yet, add it to the map below
 * — don't import @expo/vector-icons directly from screens.
 */
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'

export interface IconProps {
  size?: number
  color?: string
}

type FeatherName = React.ComponentProps<typeof Feather>['name']
type MciName = React.ComponentProps<typeof MaterialCommunityIcons>['name']

/**
 * Many call sites pass Tamagui tokens (`$color9`, `$blue10`, etc.) for
 * color. @expo/vector-icons backends don't speak Tamagui — they want a
 * literal hex/rgb/named color, otherwise the icon renders in the
 * fallback color (usually black).
 *
 * We could read `useTheme()` from Tamagui at runtime to resolve the
 * tokens dynamically, but that adds a hooks dependency to every icon
 * (and the Tamagui dark/light split would still need a switch table).
 * Mapping the tokens we actually use to fixed hex values from the web
 * brand palette is simpler + matches the web's exact rendered color.
 */
const TOKEN_HEX: Record<string, string> = {
  // Neutral grayscale (warm-green tinted to match the design system)
  $color9: '#bdcabc', // outlineVariant
  $color10: '#6e7a6e', // outline
  $color11: '#3e4a3f', // onSurfaceVariant
  $color12: '#171d17', // onSurface
  $gray9: '#bdcabc',
  $gray10: '#6e7a6e',
  $gray11: '#3e4a3f',
  $gray12: '#171d17',
  $borderColor: '#bdcabc',
  // Brand greens — brand green palette from design.md
  $green9: '#008741', // primaryContainer
  $green10: '#006b32', // primary (the canonical brand mark)
  $green11: '#005225', // onPrimaryFixedVariant (darker brand for emphasis)
  // Reds — semantic danger
  $red9: '#E53935',
  $red10: '#E53935',
  $red11: '#ba1a1a',
  // Blues (kept only for legacy callers; brand is green)
  $blue9: '#3b82f6',
  $blue10: '#3b82f6',
  $blue11: '#2563eb',
  // Oranges — Action Orange (the design-system secondary)
  $orange9: '#fe8028', // secondaryContainer
  $orange10: '#9a4600', // secondary
  $orange11: '#763300', // onSecondaryFixedVariant
  // Ambers — kept for callsites that need a warning-yellow
  $amber9: '#FFB800', // warning
  $amber10: '#FFB800',
  $amber11: '#d97706',
}

function resolveColor(input?: string): string {
  if (!input) return '#0f172a'
  if (input.startsWith('$')) return TOKEN_HEX[input] ?? '#0f172a'
  return input
}

function featherIcon(name: FeatherName) {
  return function Icon({ size = 20, color }: IconProps) {
    return <Feather name={name} size={size} color={resolveColor(color)} />
  }
}

function mciIcon(name: MciName) {
  return function Icon({ size = 20, color }: IconProps) {
    return <MaterialCommunityIcons name={name} size={size} color={resolveColor(color)} />
  }
}

// ─── Standard set — direct Feather mapping (Lucide name → Feather name) ──

export const Mail = featherIcon('mail')
export const Lock = featherIcon('lock')
export const Eye = featherIcon('eye')
export const EyeOff = featherIcon('eye-off')
export const AlertTriangle = featherIcon('alert-triangle')
export const Calendar = featherIcon('calendar')
export const MapPin = featherIcon('map-pin')
export const Camera = featherIcon('camera')
export const CheckCircle = featherIcon('check-circle')
export const CheckCircle2 = featherIcon('check-circle')
export const Navigation = featherIcon('navigation')
export const Home = featherIcon('home')
export const ShoppingCart = featherIcon('shopping-cart')
export const MoreHorizontal = featherIcon('more-horizontal')
export const TrendingUp = featherIcon('trending-up')
export const Plus = featherIcon('plus')
export const Minus = featherIcon('minus')
export const Trash2 = featherIcon('trash-2')
export const X = featherIcon('x')
export const Search = featherIcon('search')
export const Clock = featherIcon('clock')
export const MessageCircle = featherIcon('message-circle')
export const Download = featherIcon('download')
export const Check = featherIcon('check')
export const RotateCcw = featherIcon('rotate-ccw')
export const ArrowDownToLine = featherIcon('download')
export const ArrowUpFromLine = featherIcon('upload')
export const CreditCard = featherIcon('credit-card')
export const Image = featherIcon('image')
export const ImageOff = featherIcon('image')
export const ExternalLink = featherIcon('external-link')
export const User = featherIcon('user')
export const Briefcase = featherIcon('briefcase')
export const ChevronLeft = featherIcon('chevron-left')
export const ChevronRight = featherIcon('chevron-right')
export const LogOut = featherIcon('log-out')
export const Phone = featherIcon('phone')
export const Bell = featherIcon('bell')
export const Package = featherIcon('package')
export const TrendingDown = featherIcon('trending-down')
export const AlertCircle = featherIcon('alert-circle')
export const Users = featherIcon('users')
export const ChevronDown = featherIcon('chevron-down')
export const Edit = featherIcon('edit-2')

// ─── Material Community fallbacks for icons Feather doesn't ship ─────

export const Banknote = mciIcon('cash-multiple')
export const QrCode = mciIcon('qrcode')
export const Wallet = mciIcon('wallet-outline')
export const Sparkles = mciIcon('shimmer')
export const Palette = mciIcon('palette-outline')
export const Store = mciIcon('storefront-outline')
export const Megaphone = mciIcon('bullhorn-outline')

// Brand glyph — official WhatsApp speech bubble. MCI ships a clean
// monochrome version; used on the WA-green CTA button (white on WA-green).
export const Whatsapp = mciIcon('whatsapp')

// Stamp / loyalty UI glyphs. Feather has no stamp icon and Lucide's
// "stamp" maps to MCI ticket-confirmation closest in spirit.
export const Stamp = mciIcon('ticket-confirmation-outline')
export const UserPlus = featherIcon('user-plus')
export const UserMinus = featherIcon('user-minus')
export const UserCheck = featherIcon('user-check')
export const UserX = featherIcon('user-x')

// Waving hand — used in the home greeting. We use this MCI glyph
// instead of the 👋 emoji because the emoji renders as font tofu in
// our Expo build (the custom Inter font has no emoji glyphs and the
// system emoji fallback isn't kicking in reliably).
export const HandWave = mciIcon('hand-wave')

// ─── Lainnya tab — module entry-point icons ──────────────────────────

export const Calculator = mciIcon('calculator-variant-outline')
export const Star = featherIcon('star')
export const Globe = featherIcon('globe')
export const Tag = featherIcon('tag')
export const Truck = featherIcon('truck')
export const Gift = featherIcon('gift')
export const Shield = featherIcon('shield')
export const Settings = featherIcon('settings')
export const Warehouse = mciIcon('warehouse')
export const Building2 = mciIcon('office-building')
export const Send = featherIcon('send')
export const FileText = featherIcon('file-text')
export const HelpCircle = featherIcon('help-circle')
export const BarChart2 = featherIcon('bar-chart-2')
