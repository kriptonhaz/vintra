/**
 * Shared layout for the 3 AI generation screens (konten/logo/spanduk).
 *
 * Mobile keeps the form minimal: prompt textarea + generate button +
 * recent-results gallery. Field-config-driven sub-form (style, palette,
 * etc) stays on the web for v1 — surface a hint.
 */
import { Image as RNImage, Pressable, RefreshControl, ScrollView, TextInput, useWindowDimensions } from 'react-native'
import { ActivityIndicator, Alert } from 'react-native'
import { Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from './ScreenHeader'
import { Stat } from './Money'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Image as ImageIcon,
  Sparkles,
  Trash2,
} from '~/lib/icons'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

interface AiItem {
  id: string
  prompt: string
  thumbnailUrl: string | null
  fullUrl: string | null
  createdAt: string
}

export interface AiGenerateScreenProps {
  title: string
  subtitle?: string
  promptPlaceholder: string
  /** Hint for what tweaks live in the web editor. */
  webFieldsHint: string
  status: {
    isLoading: boolean
    error: unknown
    data?: { enabled: boolean; monthlyCap?: number | null; used?: number; message?: string | null }
  }
  items: {
    isLoading: boolean
    isFetching: boolean
    error: unknown
    data?: AiItem[]
    refetch: () => unknown
  }
  /** Mutation tuple — pending flag, generate fn, error message. */
  generate: {
    isPending: boolean
    mutateAsync: (input: { prompt: string }) => Promise<unknown>
  }
  deleteItem: {
    mutate: (id: string) => void
  }
  /** True = render thumbs as square (logo); false = wide (spanduk). */
  squareAspect?: boolean
}

export function AiGenerateScreen({
  title,
  subtitle,
  promptPlaceholder,
  webFieldsHint,
  status,
  items,
  generate,
  deleteItem,
  squareAspect = true,
}: AiGenerateScreenProps) {
  return (
    <AiGenerateScreenInner
      title={title}
      subtitle={subtitle}
      promptPlaceholder={promptPlaceholder}
      webFieldsHint={webFieldsHint}
      status={status}
      items={items}
      generate={generate}
      deleteItem={deleteItem}
      squareAspect={squareAspect}
    />
  )
}

import { useState } from 'react'

function AiGenerateScreenInner({
  title,
  subtitle,
  promptPlaceholder,
  webFieldsHint,
  status,
  items,
  generate,
  deleteItem,
  squareAspect,
}: AiGenerateScreenProps) {
  const [prompt, setPrompt] = useState('')

  async function handleGenerate() {
    if (prompt.trim().length < 6) {
      Alert.alert(
        'Prompt terlalu pendek',
        'Tulis minimal 6 karakter — semakin detail, hasilnya makin akurat.',
      )
      return
    }
    try {
      await generate.mutateAsync({ prompt: prompt.trim() })
      setPrompt('')
    } catch (err) {
      Alert.alert(
        'Gagal generate',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  function confirmDelete(item: AiItem) {
    Alert.alert('Hapus hasil?', 'Hasil akan dihapus permanen.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: () => deleteItem.mutate(item.id),
      },
    ])
  }

  if (status.isLoading || items.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title={title} back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }

  if (status.data && !status.data.enabled) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title={title} back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <Sparkles size={32} color={COLORS.outline} />
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={16}
            color={COLORS.onSurface}
            ta="center"
          >
            Fitur tidak aktif
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={13}
            color={COLORS.onSurfaceVariant}
            ta="center"
          >
            {status.data.message ?? `${title} tersedia mulai paket Komplit. Upgrade dulu yuk.`}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const err = status.error ?? items.error
  if (err) {
    const isForbidden = err instanceof ApiError && err.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title={title} back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses.'
              : 'Gagal memuat.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader title={title} subtitle={subtitle} back />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl
            refreshing={items.isFetching}
            onRefresh={() => items.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Quota strip */}
        {status.data?.monthlyCap !== undefined && (
          <XStack
            ai="center"
            jc="space-between"
            bg={COLORS.surfaceContainerLowest}
            br={12}
            p="$3"
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              Pemakaian bulan ini
            </Stat>
            <Paragraph
              fontFamily={FONTS.monoMedium}
              fontSize={13}
              color={COLORS.onSurface}
            >
              {status.data.used ?? 0}
              {status.data.monthlyCap !== null ? ` / ${status.data.monthlyCap}` : ' / ∞'}
            </Paragraph>
          </XStack>
        )}

        {/* Prompt */}
        <YStack gap="$2">
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={12}
            color={COLORS.onSurface}
            textTransform="uppercase"
            letterSpacing={0.4}
          >
            Brief / Prompt
          </Paragraph>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder={promptPlaceholder}
            placeholderTextColor={COLORS.outline}
            multiline
            style={{
              backgroundColor: COLORS.surfaceContainerLowest,
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 12,
              minHeight: 120,
              borderWidth: 1,
              borderColor: COLORS.borderSubtle,
              fontFamily: FONTS.body,
              fontSize: 14,
              color: COLORS.onSurface,
              textAlignVertical: 'top',
            }}
          />
        </YStack>

        {/* Web fields hint */}
        <XStack
          ai="flex-start"
          gap="$2"
          bg={COLORS.warningTint}
          br={10}
          p="$3"
        >
          <AlertCircle size={14} color="#92400e" />
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color="#92400e"
            flex={1}
          >
            {webFieldsHint}
          </Paragraph>
        </XStack>

        <Pressable
          onPress={handleGenerate}
          disabled={generate.isPending}
          style={{
            paddingVertical: 14,
            borderRadius: 12,
            backgroundColor: generate.isPending ? COLORS.outline : COLORS.primary,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          {generate.isPending ? (
            <>
              <ActivityIndicator color="#fff" />
              <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="#fff">
                Sedang generate… (5-30 detik)
              </Paragraph>
            </>
          ) : (
            <>
              <Sparkles size={16} color="#fff" />
              <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="#fff">
                Generate
              </Paragraph>
            </>
          )}
        </Pressable>

        {/* Recent results */}
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={11}
          color={COLORS.onSurfaceVariant}
          letterSpacing={0.55}
          mt="$2"
        >
          HASIL TERBARU
        </Paragraph>
        <Gallery
          items={items.data ?? []}
          onDelete={confirmDelete}
          squareAspect={squareAspect ?? true}
        />
      </ScrollView>
    </YStack>
  )
}

function Gallery({
  items,
  onDelete,
  squareAspect,
}: {
  items: AiItem[]
  onDelete: (item: AiItem) => void
  squareAspect: boolean
}) {
  const { width } = useWindowDimensions()
  if (items.length === 0) {
    return (
      <YStack
        ai="center"
        py="$8"
        gap="$2"
        bg={COLORS.surfaceContainerLowest}
        br={14}
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
      >
        <ImageIcon size={28} color={COLORS.outline} />
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={13}
          color={COLORS.onSurfaceVariant}
        >
          Belum ada hasil di sini.
        </Paragraph>
      </YStack>
    )
  }

  if (squareAspect) {
    const itemW = (width - 16 * 2 - 8) / 2
    return (
      <XStack flexWrap="wrap" gap="$2">
        {items.map((g) => (
          <YStack
            key={g.id}
            width={itemW}
            bg={COLORS.surfaceContainerLowest}
            br={12}
            overflow="hidden"
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
            style={SHADOWS.card}
          >
            <YStack w={itemW} h={itemW} bg={COLORS.surfaceContainerLow} ai="center" jc="center">
              {g.thumbnailUrl ? (
                <RNImage
                  source={{ uri: g.thumbnailUrl }}
                  style={{ width: itemW, height: itemW }}
                />
              ) : (
                <ImageIcon size={24} color={COLORS.outline} />
              )}
            </YStack>
            <XStack ai="center" jc="space-between" p="$2">
              <CheckCircle size={12} color={COLORS.success} />
              <Pressable onPress={() => onDelete(g)} hitSlop={6}>
                <Trash2 size={12} color={COLORS.outline} />
              </Pressable>
            </XStack>
          </YStack>
        ))}
      </XStack>
    )
  }

  // Wide aspect (spanduk) — single column
  const itemW = width - 32
  const itemH = Math.round(itemW / 3) // 3:1 banner ratio
  return (
    <YStack gap="$2">
      {items.map((g) => (
        <YStack
          key={g.id}
          bg={COLORS.surfaceContainerLowest}
          br={12}
          overflow="hidden"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
          style={SHADOWS.card}
        >
          <YStack w={itemW} h={itemH} bg={COLORS.surfaceContainerLow} ai="center" jc="center">
            {g.thumbnailUrl ? (
              <RNImage
                source={{ uri: g.thumbnailUrl }}
                style={{ width: itemW, height: itemH }}
                resizeMode="cover"
              />
            ) : (
              <ImageIcon size={28} color={COLORS.outline} />
            )}
          </YStack>
          <XStack ai="center" jc="space-between" p="$2">
            <Stat fontSize={11} color={COLORS.onSurfaceVariant} flex={1} numberOfLines={1}>
              {g.prompt}
            </Stat>
            <Pressable onPress={() => onDelete(g)} hitSlop={6}>
              <Trash2 size={12} color={COLORS.outline} />
            </Pressable>
          </XStack>
        </YStack>
      ))}
    </YStack>
  )
}
