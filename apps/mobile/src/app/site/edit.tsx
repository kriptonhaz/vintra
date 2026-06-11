/**
 * Microsite — mobile manage screen.
 *
 * The desktop visual editor (sections, blocks, preview) is too dense
 * for a phone. Mobile covers the lightweight ops surface:
 *   - slug (claim/change)
 *   - maintenance mode toggle + message
 *   - publish current draft
 *   - publish history (read-only list)
 *
 * Full visual section editing is intentionally web-only — when a user
 * needs to lay out sections we surface a hint to open the web editor.
 */
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  TextInput,
} from 'react-native'
import { useRouter } from 'expo-router'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  BarChart2,
  CheckCircle,
  ExternalLink,
  Globe,
  X,
} from '~/lib/icons'
import {
  useClaimPublicSlug,
  useMySiteSettings,
  usePublishSite,
  useSetSiteMaintenanceMode,
  useSitePublishHistory,
} from '~/lib/site'
import { useTenant } from '~/lib/tenant-context'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function SiteEditScreen() {
  const router = useRouter()
  const { state: tenantState } = useTenant()
  const slug =
    tenantState.status === 'ready' ? tenantState.tenant.slug ?? null : null
  const settings = useMySiteSettings()
  const history = useSitePublishHistory()
  const publish = usePublishSite()
  const setMaintenance = useSetSiteMaintenanceMode()

  const [maintMode, setMaintMode] = useState(false)
  const [maintMsg, setMaintMsg] = useState('')
  const [slugOpen, setSlugOpen] = useState(false)

  useEffect(() => {
    if (!settings.data) return
    setMaintMode(settings.data.maintenance.mode)
    setMaintMsg(settings.data.maintenance.message ?? '')
  }, [settings.data])

  async function handlePublish() {
    Alert.alert(
      'Publish situs?',
      'Versi draft saat ini akan dipublish ke pelanggan. Pastikan section sudah benar dari editor web.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Publish',
          onPress: () =>
            publish.mutate(undefined, {
              onSuccess: () =>
                Alert.alert('Sukses', 'Situs sudah dipublish.'),
              onError: (err) =>
                Alert.alert(
                  'Gagal publish',
                  err instanceof Error ? err.message : 'Coba lagi.',
                ),
            }),
        },
      ],
    )
  }

  async function handleSaveMaintenance() {
    try {
      await setMaintenance.mutateAsync({
        mode: maintMode,
        message: maintMsg.trim() || null,
      })
      Alert.alert('Tersimpan', 'Status maintenance diperbarui.')
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  function openPublicPage() {
    if (!slug) {
      Alert.alert(
        'Slug belum dipilih',
        'Pilih slug subdomain dulu sebelum bisa lihat situs publik.',
      )
      return
    }
    void Linking.openURL(`https://${slug}.vintra.my.id`)
  }

  if (settings.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Situs" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (settings.error) {
    const isForbidden =
      settings.error instanceof ApiError && settings.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Situs" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa kelola situs.'
              : 'Gagal memuat pengaturan situs.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const isPublished = !!settings.data?.published?.publishedAt
  const lastPublished = settings.data?.published?.publishedAt

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Situs"
        subtitle={slug ? `${slug}.vintra.my.id` : 'Belum ada slug'}
        back
        right={
          <Pressable
            onPress={() => router.push('/site/analytics' as never)}
            style={{
              padding: 8,
              borderRadius: 10,
              backgroundColor: COLORS.surfaceContainerLowest,
              borderWidth: 1,
              borderColor: COLORS.borderSubtle,
            }}
          >
            <BarChart2 size={16} color={COLORS.onSurface} />
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}
          refreshControl={
            <RefreshControl
              refreshing={settings.isFetching || history.isFetching}
              onRefresh={() => {
                void settings.refetch()
                void history.refetch()
              }}
              tintColor={COLORS.primary}
            />
          }
        >
          {/* Status hero */}
          <YStack
            bg={isPublished ? COLORS.primary : COLORS.surfaceContainerLow}
            br={16}
            p="$4"
            gap="$2"
            style={SHADOWS.card}
          >
            <Paragraph
              fontFamily={FONTS.bodyMedium}
              fontSize={11}
              color={
                isPublished ? 'rgba(255,255,255,0.85)' : COLORS.onSurfaceVariant
              }
              letterSpacing={0.4}
            >
              {isPublished ? 'TERPUBLIKASI' : 'BELUM PUBLISH'}
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={20}
              color={isPublished ? '#fff' : COLORS.onSurface}
            >
              {slug ? `${slug}.vintra.my.id` : 'Pilih slug dulu'}
            </Paragraph>
            {lastPublished && (
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color="rgba(255,255,255,0.85)"
              >
                Terakhir publish {fmtDateTime(lastPublished)}
              </Paragraph>
            )}
            <XStack gap="$2" mt="$1">
              {slug && (
                <Pressable
                  onPress={openPublicPage}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 10,
                    backgroundColor: isPublished
                      ? 'rgba(255,255,255,0.18)'
                      : COLORS.surface,
                    borderWidth: isPublished ? 0 : 1,
                    borderColor: COLORS.borderSubtle,
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <ExternalLink
                    size={14}
                    color={isPublished ? '#fff' : COLORS.onSurface}
                  />
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={12}
                    color={isPublished ? '#fff' : COLORS.onSurface}
                  >
                    Lihat publik
                  </Paragraph>
                </Pressable>
              )}
              <Pressable
                onPress={handlePublish}
                disabled={publish.isPending}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  backgroundColor: publish.isPending
                    ? COLORS.outline
                    : isPublished
                      ? COLORS.surface
                      : COLORS.primary,
                  borderWidth: isPublished ? 1 : 0,
                  borderColor: COLORS.borderSubtle,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                {publish.isPending ? (
                  <ActivityIndicator
                    color={isPublished ? COLORS.primary : '#fff'}
                  />
                ) : (
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={12}
                    color={isPublished ? COLORS.onSurface : '#fff'}
                  >
                    {isPublished ? 'Re-publish' : 'Publish'}
                  </Paragraph>
                )}
              </Pressable>
            </XStack>
          </YStack>

          {/* Slug */}
          <Section title="Subdomain">
            <Pressable onPress={() => setSlugOpen(true)}>
              <XStack
                ai="center"
                jc="space-between"
                bg={COLORS.surface}
                br={10}
                px="$3"
                py="$3"
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
              >
                <XStack ai="center" gap="$2">
                  <Globe size={16} color={COLORS.primary} />
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={14}
                    color={slug ? COLORS.onSurface : COLORS.outline}
                  >
                    {slug ? `${slug}.vintra.my.id` : 'Pilih slug'}
                  </Paragraph>
                </XStack>
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={12}
                  color={COLORS.primary}
                >
                  Ganti
                </Paragraph>
              </XStack>
            </Pressable>
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              Slug adalah alamat publik situs. Ganti hati-hati — link lama
              akan menjadi tidak valid.
            </Stat>
          </Section>

          {/* Maintenance */}
          <Section title="Mode maintenance">
            <XStack ai="center" jc="space-between">
              <YStack flex={1}>
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={14}
                  color={COLORS.onSurface}
                >
                  Aktifkan
                </Paragraph>
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={11}
                  color={COLORS.onSurfaceVariant}
                >
                  Pengunjung lihat pesan custom alih-alih situs penuh.
                </Paragraph>
              </YStack>
              <Switch
                value={maintMode}
                onValueChange={setMaintMode}
                trackColor={{ false: COLORS.outline, true: COLORS.primary }}
                thumbColor="#fff"
              />
            </XStack>
            {maintMode && (
              <TextInput
                value={maintMsg}
                onChangeText={setMaintMsg}
                placeholder="Mis. Sedang renovasi, kembali jam 14:00"
                placeholderTextColor={COLORS.outline}
                multiline
                style={{
                  backgroundColor: COLORS.surface,
                  borderRadius: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  minHeight: 70,
                  borderWidth: 1,
                  borderColor: COLORS.borderSubtle,
                  fontFamily: FONTS.body,
                  fontSize: 13,
                  color: COLORS.onSurface,
                  textAlignVertical: 'top',
                  marginTop: 8,
                }}
              />
            )}
            <Pressable
              onPress={handleSaveMaintenance}
              disabled={setMaintenance.isPending}
              style={{
                marginTop: 4,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: setMaintenance.isPending
                  ? COLORS.outline
                  : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {setMaintenance.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={13}
                  color="#fff"
                >
                  Simpan
                </Paragraph>
              )}
            </Pressable>
          </Section>

          {/* Visual editor — web only */}
          <YStack
            bg={COLORS.warningTint}
            br={12}
            p="$3"
            gap="$2"
            borderWidth={1}
            borderColor="#92400e"
          >
            <XStack ai="flex-start" gap="$2">
              <AlertCircle size={16} color="#92400e" />
              <YStack flex={1}>
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={13}
                  color="#92400e"
                >
                  Editor section ada di web
                </Paragraph>
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={12}
                  color="#92400e"
                >
                  Atur tata letak section, gambar, tombol CTA lewat
                  vintra.my.id/site/edit. Layar mobile ini hanya untuk
                  publish + maintenance — preview di sini dulu, lalu
                  re-publish kalau ada perubahan.
                </Paragraph>
              </YStack>
            </XStack>
          </YStack>

          {/* Publish history */}
          <Section title="Riwayat publish">
            {history.isLoading ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (history.data ?? []).length === 0 ? (
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color={COLORS.onSurfaceVariant}
              >
                Belum pernah dipublish.
              </Paragraph>
            ) : (
              (history.data ?? []).slice(0, 5).map((h) => (
                <XStack
                  key={h.id}
                  ai="center"
                  gap="$2"
                  py="$2"
                  borderBottomWidth={1}
                  borderBottomColor={COLORS.borderSubtle}
                >
                  <CheckCircle size={14} color={COLORS.success} />
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={13}
                    color={COLORS.onSurface}
                    flex={1}
                  >
                    {fmtDateTime(h.publishedAt)}
                  </Paragraph>
                </XStack>
              ))
            )}
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>

      {slugOpen && (
        <SlugModal
          currentSlug={slug}
          onClose={() => setSlugOpen(false)}
        />
      )}
    </YStack>
  )
}

function SlugModal({
  currentSlug,
  onClose,
}: {
  currentSlug: string | null
  onClose: () => void
}) {
  const claim = useClaimPublicSlug()
  const [value, setValue] = useState(currentSlug ?? '')

  async function submit() {
    const cleaned = value.trim().toLowerCase()
    if (!/^[a-z0-9-]{3,40}$/.test(cleaned)) {
      Alert.alert(
        'Slug tidak valid',
        'Hanya huruf kecil, angka, dan dash. 3-40 karakter.',
      )
      return
    }
    try {
      await claim.mutateAsync(cleaned)
      onClose()
      Alert.alert(
        'Slug terklaim',
        'Refresh app jika subdomain belum berubah di header.',
      )
    } catch (err) {
      Alert.alert(
        'Gagal klaim slug',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <YStack flex={1} bg={COLORS.background}>
        <XStack
          ai="center"
          jc="space-between"
          px="$4"
          pt="$5"
          pb="$3"
          borderBottomWidth={1}
          borderBottomColor={COLORS.borderSubtle}
        >
          <H2 fontSize={18} color={COLORS.onSurface}>
            Ganti slug
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color={COLORS.onSurfaceVariant}
          >
            Pilih subdomain unik untuk situs publik. Setelah diklaim,
            URL akan jadi <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={12}
              color={COLORS.onSurface}
            >
              {value || '...'}.vintra.my.id
            </Paragraph>
            .
          </Paragraph>
          <TextInput
            value={value}
            onChangeText={(v) => setValue(v.toLowerCase().replace(/\s+/g, '-'))}
            placeholder="mis. tokoaku"
            placeholderTextColor={COLORS.outline}
            autoCapitalize="none"
            maxLength={40}
            autoFocus
            style={{
              backgroundColor: COLORS.surfaceContainerLowest,
              borderRadius: 10,
              paddingHorizontal: 14,
              height: 44,
              borderWidth: 1,
              borderColor: COLORS.borderSubtle,
              fontFamily: FONTS.monoMedium,
              fontSize: 14,
              color: COLORS.onSurface,
            }}
          />
          <Pressable
            onPress={submit}
            disabled={claim.isPending}
            style={{
              marginTop: 8,
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: claim.isPending ? COLORS.outline : COLORS.primary,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {claim.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="#fff">
                Klaim
              </Paragraph>
            )}
          </Pressable>
        </ScrollView>
      </YStack>
    </Modal>
  )
}

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
      br={14}
      p="$3"
      gap="$3"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={13}
        color={COLORS.onSurface}
      >
        {title}
      </Paragraph>
      {children}
    </YStack>
  )
}
