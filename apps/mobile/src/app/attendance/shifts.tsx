/**
 * Shifts — list per branch + create/rename/delete + per-shift weekly
 * schedule editor.
 *
 * The shift entity is just a name; the actual work hours live in
 * `branch_shift_schedules` (one row per day-of-week). The server
 * upserts all 7 rows in a single `setShiftSchedule` call so the UI
 * always sends the full week.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  TextInput,
} from 'react-native'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronRight,
  Edit,
  Plus,
  Trash2,
  Users,
  X,
} from '~/lib/icons'
import {
  useAccessibleBranches,
  useCreateShift,
  useDeleteShift,
  useSetShiftSchedule,
  useShiftWithSchedule,
  useShifts,
  useUpdateShift,
  type ShiftRow,
  type ShiftScheduleDay,
} from '~/lib/attendance'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

function emptyWeek(): ShiftScheduleDay[] {
  return Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    isWorkDay: i >= 1 && i <= 5, // Mon-Fri default
    clockInTime: '08:00',
    clockOutTime: '17:00',
    lateGraceMinutes: 10,
    earlyLeaveGraceMinutes: 0,
  }))
}

export default function ShiftsScreen() {
  const branchesQuery = useAccessibleBranches()
  const branches = branchesQuery.data?.branches ?? []
  const [branchId, setBranchId] = useState<string | null>(null)
  const shiftsQuery = useShifts(branchId)
  const deleteShift = useDeleteShift()
  const [editingShift, setEditingShift] = useState<ShiftRow | 'new' | null>(null)
  const [scheduleShiftId, setScheduleShiftId] = useState<string | null>(null)
  const [branchPickerOpen, setBranchPickerOpen] = useState(false)

  useEffect(() => {
    if (!branchId && branches.length > 0) {
      setBranchId(branches[0]!.id)
    }
  }, [branchId, branches])

  function confirmDelete(s: ShiftRow) {
    Alert.alert(
      `Hapus shift "${s.name}"?`,
      s.staffCount > 0
        ? `${s.staffCount} staff masih ditugaskan ke shift ini. Mereka akan otomatis tanpa shift setelah dihapus.`
        : 'Shift akan dihapus permanen.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () =>
            deleteShift.mutate(s.id, {
              onError: (err) =>
                Alert.alert(
                  'Gagal hapus',
                  err instanceof Error ? err.message : 'Coba lagi.',
                ),
            }),
        },
      ],
    )
  }

  if (branchesQuery.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Shift" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }

  if (branchesQuery.error) {
    const isForbidden =
      branchesQuery.error instanceof ApiError &&
      branchesQuery.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Shift" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke shift.'
              : 'Gagal memuat cabang.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const branchName = branches.find((b) => b.id === branchId)?.name
  const rows = shiftsQuery.data ?? []

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Shift"
        subtitle={`${rows.length} shift di ${branchName ?? 'cabang'}`}
        back
        right={
          <Pressable
            onPress={() => setEditingShift('new')}
            disabled={!branchId}
            style={{
              backgroundColor: branchId ? COLORS.primary : COLORS.outline,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Plus size={14} color="#fff" />
            <Paragraph fontFamily={FONTS.bodyBold} fontSize={12} color="#fff">
              Baru
            </Paragraph>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={shiftsQuery.isFetching}
            onRefresh={() => shiftsQuery.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {branches.length > 1 && (
          <Pressable
            onPress={() => setBranchPickerOpen(true)}
            style={{
              backgroundColor: COLORS.surfaceContainerLowest,
              borderRadius: 12,
              padding: 14,
              borderWidth: 1,
              borderColor: COLORS.borderSubtle,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <YStack>
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={11}
                color={COLORS.onSurfaceVariant}
                letterSpacing={0.4}
                textTransform="uppercase"
              >
                Cabang
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.bodyMedium}
                fontSize={14}
                color={COLORS.onSurface}
              >
                {branchName ?? '-'}
              </Paragraph>
            </YStack>
            <ChevronRight size={18} color={COLORS.outline} />
          </Pressable>
        )}

        {rows.length === 0 ? (
          <YStack
            ai="center"
            gap="$3"
            py="$8"
            bg={COLORS.surfaceContainerLowest}
            br={16}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
            px="$5"
          >
            <YStack
              w={64}
              h={64}
              br={20}
              bg={COLORS.primaryFixed}
              ai="center"
              jc="center"
            >
              <Calendar size={26} color={COLORS.primary} />
            </YStack>
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={16}
              color={COLORS.onSurface}
            >
              Belum ada shift
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
            >
              Buat shift untuk atur jam kerja staff per hari.
            </Paragraph>
            <Pressable
              onPress={() => setEditingShift('new')}
              disabled={!branchId}
              style={{
                marginTop: 4,
                paddingHorizontal: 16,
                paddingVertical: 10,
                backgroundColor: branchId ? COLORS.primary : COLORS.outline,
                borderRadius: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Plus size={14} color="#fff" />
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color="#fff"
              >
                Buat shift baru
              </Paragraph>
            </Pressable>
          </YStack>
        ) : (
          rows.map((s) => (
            <ShiftCard
              key={s.id}
              shift={s}
              onEditName={() => setEditingShift(s)}
              onEditSchedule={() => setScheduleShiftId(s.id)}
              onDelete={() => confirmDelete(s)}
            />
          ))
        )}
      </ScrollView>

      {/* Edit name / create modal */}
      {editingShift !== null && branchId && (
        <ShiftEditorModal
          mode={editingShift === 'new' ? 'create' : 'edit'}
          shift={editingShift === 'new' ? null : editingShift}
          branchId={branchId}
          onClose={() => setEditingShift(null)}
        />
      )}

      {/* Schedule modal */}
      {scheduleShiftId && (
        <ScheduleModal
          shiftId={scheduleShiftId}
          onClose={() => setScheduleShiftId(null)}
        />
      )}

      <PickList
        visible={branchPickerOpen}
        title="Pilih cabang"
        items={branches.map((b) => ({ key: b.id, label: b.name }))}
        selectedKey={branchId ?? ''}
        onClose={() => setBranchPickerOpen(false)}
        onSelect={(id) => {
          setBranchId(id)
          setBranchPickerOpen(false)
        }}
      />
    </YStack>
  )
}

function ShiftCard({
  shift,
  onEditName,
  onEditSchedule,
  onDelete,
}: {
  shift: ShiftRow
  onEditName: () => void
  onEditSchedule: () => void
  onDelete: () => void
}) {
  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={14}
      p="$3"
      gap="$2"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <XStack ai="center" jc="space-between">
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.bodySemi}
            fontSize={14}
            color={COLORS.onSurface}
          >
            {shift.name}
          </Paragraph>
          <XStack ai="center" gap="$1">
            <Users size={11} color={COLORS.onSurfaceVariant} />
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              {shift.staffCount} staff
            </Stat>
          </XStack>
        </YStack>
        <Pressable onPress={onEditName} hitSlop={6} style={{ padding: 6 }}>
          <Edit size={16} color={COLORS.outline} />
        </Pressable>
      </XStack>
      <XStack ai="center" gap="$2" mt="$1">
        <Pressable
          onPress={onEditSchedule}
          style={{
            flex: 1,
            paddingVertical: 8,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: COLORS.borderSubtle,
            backgroundColor: COLORS.surface,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Calendar size={13} color={COLORS.onSurface} />
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={12}
            color={COLORS.onSurface}
          >
            Atur jadwal mingguan
          </Paragraph>
        </Pressable>
        <Pressable
          onPress={onDelete}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: COLORS.dangerTint,
            backgroundColor: COLORS.dangerTint,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Trash2 size={13} color={COLORS.danger} />
        </Pressable>
      </XStack>
    </YStack>
  )
}

// ─── Create / rename shift modal ───────────────────────────────────

function ShiftEditorModal({
  mode,
  shift,
  branchId,
  onClose,
}: {
  mode: 'create' | 'edit'
  shift: ShiftRow | null
  branchId: string
  onClose: () => void
}) {
  const [name, setName] = useState(shift?.name ?? '')
  const create = useCreateShift()
  const update = useUpdateShift()

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Nama wajib', 'Tulis nama shift sebelum simpan.')
      return
    }
    try {
      if (mode === 'create') {
        await create.mutateAsync({ branchId, name: name.trim() })
      } else if (shift) {
        await update.mutateAsync({ id: shift.id, name: name.trim() })
      }
      onClose()
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
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
            {mode === 'create' ? 'Shift baru' : 'Edit shift'}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={12}
            color={COLORS.onSurface}
            textTransform="uppercase"
            letterSpacing={0.4}
          >
            Nama shift
          </Paragraph>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Mis. Pagi, Siang, Malam"
            placeholderTextColor={COLORS.outline}
            maxLength={50}
            autoFocus
            style={{
              backgroundColor: COLORS.surfaceContainerLowest,
              borderRadius: 10,
              paddingHorizontal: 14,
              height: 44,
              borderWidth: 1,
              borderColor: COLORS.borderSubtle,
              fontFamily: FONTS.body,
              fontSize: 14,
              color: COLORS.onSurface,
            }}
          />
          <Pressable
            onPress={handleSave}
            disabled={create.isPending || update.isPending}
            style={{
              marginTop: 8,
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor:
                create.isPending || update.isPending
                  ? COLORS.outline
                  : COLORS.primary,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {create.isPending || update.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={14}
                color="#fff"
              >
                Simpan
              </Paragraph>
            )}
          </Pressable>
        </ScrollView>
      </YStack>
    </Modal>
  )
}

// ─── Schedule modal (7-day editor) ─────────────────────────────────

function ScheduleModal({
  shiftId,
  onClose,
}: {
  shiftId: string
  onClose: () => void
}) {
  const query = useShiftWithSchedule(shiftId)
  const setSchedule = useSetShiftSchedule()
  const [days, setDays] = useState<ShiftScheduleDay[]>(emptyWeek())

  useEffect(() => {
    if (!query.data) return
    const merged = emptyWeek()
    for (const s of query.data.schedules) {
      merged[s.dayOfWeek] = {
        dayOfWeek: s.dayOfWeek,
        isWorkDay: s.isWorkDay,
        clockInTime: s.clockInTime ?? '08:00',
        clockOutTime: s.clockOutTime ?? '17:00',
        lateGraceMinutes: s.lateGraceMinutes,
        earlyLeaveGraceMinutes: s.earlyLeaveGraceMinutes,
      }
    }
    setDays(merged)
  }, [query.data])

  function updateDay(idx: number, patch: Partial<ShiftScheduleDay>) {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)))
  }

  async function handleSave() {
    try {
      await setSchedule.mutateAsync({ shiftId, days })
      Alert.alert('Tersimpan', 'Jadwal mingguan diperbarui.')
      onClose()
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
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
            Jadwal mingguan
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 80 }}>
            {query.isLoading ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              days.map((d, idx) => (
                <DayRow
                  key={d.dayOfWeek}
                  day={d}
                  onChange={(patch) => updateDay(idx, patch)}
                />
              ))
            )}

            <Pressable
              onPress={handleSave}
              disabled={setSchedule.isPending}
              style={{
                marginTop: 16,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor: setSchedule.isPending
                  ? COLORS.outline
                  : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {setSchedule.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Check size={16} color="#fff" />
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={14}
                    color="#fff"
                  >
                    Simpan jadwal
                  </Paragraph>
                </>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </YStack>
    </Modal>
  )
}

function DayRow({
  day,
  onChange,
}: {
  day: ShiftScheduleDay
  onChange: (patch: Partial<ShiftScheduleDay>) => void
}) {
  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={12}
      p="$3"
      gap="$2"
      borderWidth={1}
      borderColor={
        day.isWorkDay ? COLORS.primary : COLORS.borderSubtle
      }
    >
      <XStack ai="center" jc="space-between">
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={13}
          color={COLORS.onSurface}
        >
          {DAY_NAMES[day.dayOfWeek]}{' '}
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
          >
            ({day.isWorkDay ? 'Kerja' : 'Libur'})
          </Paragraph>
        </Paragraph>
        <Switch
          value={day.isWorkDay}
          onValueChange={(v) => onChange({ isWorkDay: v })}
          trackColor={{ false: COLORS.outline, true: COLORS.primary }}
          thumbColor="#fff"
        />
      </XStack>
      {day.isWorkDay && (
        <XStack gap="$2">
          <YStack flex={1} gap={4}>
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={10}
              color={COLORS.onSurfaceVariant}
              letterSpacing={0.4}
              textTransform="uppercase"
            >
              Masuk
            </Paragraph>
            <TextInput
              value={day.clockInTime ?? ''}
              onChangeText={(v) => onChange({ clockInTime: v })}
              placeholder="08:00"
              placeholderTextColor={COLORS.outline}
              maxLength={5}
              style={timeInputStyle}
            />
          </YStack>
          <YStack flex={1} gap={4}>
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={10}
              color={COLORS.onSurfaceVariant}
              letterSpacing={0.4}
              textTransform="uppercase"
            >
              Pulang
            </Paragraph>
            <TextInput
              value={day.clockOutTime ?? ''}
              onChangeText={(v) => onChange({ clockOutTime: v })}
              placeholder="17:00"
              placeholderTextColor={COLORS.outline}
              maxLength={5}
              style={timeInputStyle}
            />
          </YStack>
        </XStack>
      )}
    </YStack>
  )
}

function PickList({
  visible,
  title,
  items,
  selectedKey,
  onClose,
  onSelect,
}: {
  visible: boolean
  title: string
  items: Array<{ key: string; label: string }>
  selectedKey: string
  onClose: () => void
  onSelect: (key: string) => void
}) {
  return (
    <Modal
      visible={visible}
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
                  br={12}
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

const timeInputStyle = {
  backgroundColor: COLORS.surface,
  borderRadius: 10,
  paddingHorizontal: 12,
  height: 40,
  borderWidth: 1,
  borderColor: COLORS.borderSubtle,
  fontFamily: FONTS.monoMedium,
  fontSize: 14,
  color: COLORS.onSurface,
  textAlign: 'center' as const,
}
