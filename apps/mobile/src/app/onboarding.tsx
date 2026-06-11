/**
 * Onboarding — one-time tenant setup form after first signup.
 */
import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { Briefcase, Check, ChevronRight, Phone, Store, Users, X } from '~/lib/icons'
import { callServerFn } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const CATEGORIES = [
  'Makanan & Minuman',
  'Retail / Toko',
  'Jasa / Salon / Bengkel',
  'Penginapan',
  'Kesehatan',
  'Pendidikan',
  'Lainnya',
]

const EMPLOYEE_RANGES = ['1-3', '4-10', '11-25', '26-50', '50+']

export default function OnboardingScreen() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [employees, setEmployees] = useState('')
  const [phone, setPhone] = useState('')
  const [picker, setPicker] = useState<null | 'category' | 'employees'>(null)
  const complete = useMutation({
    mutationFn: (input: {
      businessName: string
      businessCategory: string
      employeeRange: string
      phone: string
    }) => callServerFn<{ success: true }>('completeOnboarding', input),
  })

  async function submit() {
    if (!name.trim() || !category || !employees || !phone.trim()) {
      Alert.alert('Lengkapi semua field', 'Isi semua data untuk lanjut.')
      return
    }
    if (phone.trim().length < 8) {
      Alert.alert('Nomor terlalu pendek', 'Isi nomor HP yang valid.')
      return
    }
    try {
      await complete.mutateAsync({
        businessName: name.trim(),
        businessCategory: category,
        employeeRange: employees,
        phone: phone.trim(),
      })
      router.replace('/(tabs)' as never)
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <YStack
        bg={COLORS.primary}
        pt={60}
        pb="$5"
        px="$5"
        gap="$2"
      >
        <Paragraph
          fontFamily={FONTS.bodyMedium}
          fontSize={12}
          color="rgba(255,255,255,0.85)"
        >
          Selamat datang!
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.headingBold}
          fontSize={22}
          color="#fff"
        >
          Atur Usahamu
        </Paragraph>
        <Paragraph
          fontFamily={FONTS.body}
          fontSize={13}
          color="rgba(255,255,255,0.85)"
        >
          Sebentar lagi siap pakai. Isi 4 hal di bawah.
        </Paragraph>
      </YStack>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}
        >
          <FieldRow icon={Store} label="Nama usaha" required>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Mis. Toko Berkah"
              placeholderTextColor={COLORS.outline}
              autoFocus
              style={inputStyle}
            />
          </FieldRow>

          <FieldRow icon={Briefcase} label="Kategori usaha" required>
            <Pressable onPress={() => setPicker('category')}>
              <XStack
                ai="center"
                jc="space-between"
                bg={COLORS.surfaceContainerLowest}
                br={10}
                px="$3"
                h={44}
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
              >
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={14}
                  color={category ? COLORS.onSurface : COLORS.outline}
                >
                  {category || 'Pilih kategori'}
                </Paragraph>
                <ChevronRight size={16} color={COLORS.outline} />
              </XStack>
            </Pressable>
          </FieldRow>

          <FieldRow icon={Users} label="Jumlah karyawan" required>
            <Pressable onPress={() => setPicker('employees')}>
              <XStack
                ai="center"
                jc="space-between"
                bg={COLORS.surfaceContainerLowest}
                br={10}
                px="$3"
                h={44}
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
              >
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={14}
                  color={employees ? COLORS.onSurface : COLORS.outline}
                >
                  {employees || 'Pilih jumlah'}
                </Paragraph>
                <ChevronRight size={16} color={COLORS.outline} />
              </XStack>
            </Pressable>
          </FieldRow>

          <FieldRow icon={Phone} label="Nomor HP / WA" required>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="08xx"
              placeholderTextColor={COLORS.outline}
              keyboardType="phone-pad"
              maxLength={20}
              style={inputStyle}
            />
          </FieldRow>

          <Pressable
            onPress={submit}
            disabled={complete.isPending}
            style={{
              marginTop: 8,
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: complete.isPending ? COLORS.outline : COLORS.primary,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {complete.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Check size={16} color="#fff" />
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Selesai & Mulai
                </Paragraph>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      {picker === 'category' && (
        <PickList
          title="Pilih kategori"
          items={CATEGORIES.map((c) => ({ key: c, label: c }))}
          selectedKey={category}
          onClose={() => setPicker(null)}
          onSelect={(k) => {
            setCategory(k)
            setPicker(null)
          }}
        />
      )}
      {picker === 'employees' && (
        <PickList
          title="Pilih jumlah karyawan"
          items={EMPLOYEE_RANGES.map((r) => ({ key: r, label: r }))}
          selectedKey={employees}
          onClose={() => setPicker(null)}
          onSelect={(k) => {
            setEmployees(k)
            setPicker(null)
          }}
        />
      )}
    </YStack>
  )
}

function FieldRow({
  icon: Icon,
  label,
  required,
  children,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <YStack gap="$2">
      <XStack ai="center" gap="$2">
        <Icon size={14} color={COLORS.primary} />
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={12}
          color={COLORS.onSurface}
          textTransform="uppercase"
          letterSpacing={0.4}
        >
          {label}
          {required ? ' *' : ''}
        </Paragraph>
      </XStack>
      {children}
    </YStack>
  )
}

function PickList({
  title,
  items,
  selectedKey,
  onClose,
  onSelect,
}: {
  title: string
  items: Array<{ key: string; label: string }>
  selectedKey: string
  onClose: () => void
  onSelect: (key: string) => void
}) {
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
            {title}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
          {items.map((it) => {
            const on = it.key === selectedKey
            return (
              <Pressable key={it.key} onPress={() => onSelect(it.key)}>
                <XStack
                  ai="center"
                  jc="space-between"
                  p="$3"
                  br={10}
                  bg={on ? COLORS.primaryFixed : COLORS.surfaceContainerLowest}
                  borderWidth={1}
                  borderColor={on ? COLORS.primary : COLORS.borderSubtle}
                >
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={14}
                    color={COLORS.onSurface}
                  >
                    {it.label}
                  </Paragraph>
                  {on && <Check size={16} color={COLORS.primary} />}
                </XStack>
              </Pressable>
            )
          })}
        </ScrollView>
      </YStack>
    </Modal>
  )
}

const _SHADOWS = SHADOWS

const inputStyle = {
  backgroundColor: COLORS.surfaceContainerLowest,
  borderRadius: 10,
  paddingHorizontal: 14,
  height: 44,
  borderWidth: 1,
  borderColor: COLORS.borderSubtle,
  fontFamily: FONTS.body,
  fontSize: 14,
  color: COLORS.onSurface,
}
