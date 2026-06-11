import { useState, useEffect, useMemo } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, Users, UserMinus, UserPlus } from 'lucide-react'
import { listBranches } from '@/server/functions/attendance-branches'
import {
  listShifts,
  getShiftWithSchedule,
  createShift,
  updateShift,
  deleteShift,
  setShiftSchedule,
  setStaffShift,
} from '@/server/functions/attendance-shifts'
import { listStaff } from '@/server/functions/attendance-staff'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetContent,
} from '@/components/ui/sheet'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useBranch } from '@/hooks/use-branch'

export const Route = createFileRoute('/_authed/attendance/shifts')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    if (!user?.permissions?.includes('attendance.manage')) {
      throw redirect({ to: '/attendance' })
    }
  },
  loader: async () => {
    const [branches, shifts, staff] = await Promise.all([
      listBranches(),
      listShifts({ data: {} }),
      listStaff(),
    ])
    return { branches, shifts, staff }
  },
  component: ShiftsPage,
})

type Branch = Awaited<ReturnType<typeof listBranches>>[number]
type Shift = Awaited<ReturnType<typeof listShifts>>[number]
type Staff = Awaited<ReturnType<typeof listStaff>>[number]

function ShiftsPage() {
  const { branches, shifts, staff } = Route.useLoaderData()
  const router = useRouter()
  const { t } = useTranslation()

  // Branch comes from the global topbar switcher — single source of truth.
  const { selectedBranchId } = useBranch()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Shift | null>(null)
  const [editingSchedule, setEditingSchedule] = useState<Shift | null>(null)
  const [viewingStaff, setViewingStaff] = useState<Shift | null>(null)

  const filteredShifts = useMemo(
    () => shifts.filter((s) => s.branchId === selectedBranchId),
    [shifts, selectedBranchId],
  )

  // Active staff of the selected branch with no shift assignment — they
  // follow the branch schedule. Surfaced so the owner can spot anyone
  // who still needs to be placed on a shift.
  const unassignedStaff = useMemo(
    () =>
      staff.filter(
        (s) =>
          s.branchId === selectedBranchId &&
          s.branchShiftId === null &&
          s.isActive,
      ),
    [staff, selectedBranchId],
  )

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('shifts.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('shifts.subtitle')}
          </p>
        </div>
        <Button
          variant="brand"
          onClick={() => setCreating(true)}
          disabled={branches.length === 0 || !selectedBranchId}
          title={branches.length === 0 ? t('shifts.needBranchFirst') : undefined}
        >
          <Plus className="h-4 w-4" />
          {t('shifts.addShift')}
        </Button>
      </div>

      {branches.length === 0 && (
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-4 text-sm text-warning-800 dark:border-warning-900 dark:bg-warning-900/20 dark:text-warning-200">
          {t('shifts.needBranchFirst')}
        </div>
      )}

      {branches.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('shifts.colName')}</TableHead>
                <TableHead>{t('shifts.colStatus')}</TableHead>
                <TableHead>{t('shifts.colStaff')}</TableHead>
                <TableHead className="text-right">
                  {t('shifts.colActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredShifts.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                  >
                    {t('shifts.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                filteredShifts.map((s) => (
                  <TableRow
                    key={s.id}
                    onClick={() => setViewingStaff(s)}
                    className={`cursor-pointer ${s.isActive ? '' : 'opacity-60'}`}
                  >
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      <span
                        className={
                          s.isActive
                            ? 'inline-flex rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-400'
                            : 'inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                        }
                      >
                        {s.isActive ? t('shifts.active') : t('shifts.inactive')}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {s.staffCount}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingSchedule(s)
                          }}
                        >
                          {t('shifts.editSchedule')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditing(s)
                          }}
                        >
                          {t('common.edit')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {branches.length > 0 && unassignedStaff.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-warning-200 bg-warning-50 dark:border-warning-900/40 dark:bg-warning-900/10">
          <div className="flex items-center gap-2 border-b border-warning-200 px-5 py-3 dark:border-warning-900/40">
            <UserMinus className="h-4 w-4 text-warning-700 dark:text-warning-400" />
            <h2 className="text-sm font-semibold text-warning-900 dark:text-warning-200">
              {t('shifts.unassignedTitle', { count: unassignedStaff.length })}
            </h2>
          </div>
          <div className="divide-y divide-warning-200/70 dark:divide-warning-900/40">
            {unassignedStaff.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 px-5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {s.fullName ?? '—'}
                  </p>
                  {s.position && (
                    <p className="truncate text-xs text-gray-500">
                      {s.position}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="border-t border-warning-200 px-5 py-2.5 text-xs text-warning-700 dark:border-warning-900/40 dark:text-warning-300">
            {t('shifts.unassignedHint')}
          </p>
        </div>
      )}

      {creating && selectedBranchId && (
        <CreateShiftSheet
          branchId={selectedBranchId}
          branchName={
            branches.find((b) => b.id === selectedBranchId)?.name ?? ''
          }
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false)
            await router.invalidate()
          }}
        />
      )}

      {editing && (
        <EditShiftSheet
          shift={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await router.invalidate()
          }}
          onDeleted={async () => {
            setEditing(null)
            await router.invalidate()
          }}
        />
      )}

      {editingSchedule && (
        <EditShiftScheduleSheet
          shift={editingSchedule}
          onClose={() => setEditingSchedule(null)}
          onSaved={async () => {
            setEditingSchedule(null)
            await router.invalidate()
          }}
        />
      )}

      {viewingStaff && (
        <ShiftStaffSheet
          shift={viewingStaff}
          allStaff={staff}
          onClose={() => setViewingStaff(null)}
          onChanged={() => router.invalidate()}
        />
      )}
    </div>
  )
}

// ─── Shift staff sheet (assign / remove) ────────────

function ShiftStaffSheet({
  shift,
  allStaff,
  onClose,
  onChanged,
}: {
  shift: Shift
  allStaff: Staff[]
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pickId, setPickId] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Recomputed from the freshest loader data each render — after a
  // mutation the parent invalidates and `allStaff` updates in place.
  const assigned = allStaff.filter((s) => s.branchShiftId === shift.id)
  const available = allStaff.filter(
    (s) =>
      s.branchId === shift.branchId &&
      s.branchShiftId === null &&
      s.isActive,
  )

  async function move(staffProfileId: string, branchShiftId: string | null) {
    setBusyId(staffProfileId)
    setError(null)
    try {
      await setStaffShift({ data: { staffProfileId, branchShiftId } })
      toast({
        title: t('common.toastSavedTitle'),
        description:
          branchShiftId === null
            ? t('shifts.staffRemoved')
            : t('shifts.staffAdded'),
        variant: 'success',
      })
      setPickId('')
      await onChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal'
      setError(msg)
      toast({
        title: t('common.toastFailedTitle'),
        description: msg,
        variant: 'error',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('shifts.staffSheetTitle', { name: shift.name })}</SheetTitle>
        <SheetDescription>{t('shifts.staffSheetDesc')}</SheetDescription>
      </SheetHeader>
      <SheetContent>
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t('shifts.staffAssignedTitle', { count: assigned.length })}
            </h3>
            {assigned.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-600">
                {t('shifts.staffEmpty')}
              </p>
            ) : (
              <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                {assigned.map((s) => (
                  <li
                    key={s.id}
                    className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
                      s.isActive ? '' : 'opacity-60'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {s.fullName ?? '—'}
                      </p>
                      {s.position && (
                        <p className="truncate text-xs text-gray-500">
                          {s.position}
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={busyId === s.id}
                      onClick={() => move(s.id, null)}
                      className="shrink-0 text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-900/30"
                    >
                      <UserMinus className="h-4 w-4" />
                      {t('shifts.staffRemove')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t('shifts.staffAddTitle')}
            </h3>
            {available.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('shifts.staffNoneAvailable')}
              </p>
            ) : (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Select
                    value={pickId}
                    onChange={(e) => setPickId(e.target.value)}
                    options={[
                      { value: '', label: t('shifts.staffPickPlaceholder') },
                      ...available.map((s) => ({
                        value: s.id,
                        label: s.fullName ?? '—',
                      })),
                    ]}
                  />
                </div>
                <Button
                  type="button"
                  variant="brand"
                  loading={busyId === pickId && pickId !== ''}
                  disabled={!pickId}
                  onClick={() => pickId && move(pickId, shift.id)}
                >
                  <UserPlus className="h-4 w-4" />
                  {t('shifts.staffAdd')}
                </Button>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Create sheet ──────────────────────────────────

const createShiftSchema = z.object({
  name: z.string().min(1, 'Nama shift wajib diisi').max(50),
})
type CreateShiftForm = z.infer<typeof createShiftSchema>

function CreateShiftSheet({
  branchId,
  branchName,
  onClose,
  onSaved,
}: {
  branchId: string
  branchName: string
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<CreateShiftForm>({
    resolver: zodResolver(createShiftSchema),
    defaultValues: { name: '' },
  })

  async function handleSubmit(values: CreateShiftForm) {
    setServerError(null)
    try {
      await createShift({ data: { branchId, name: values.name } })
      toast({
        title: t('common.toastSavedTitle'),
        description: t('shifts.toastCreated', { name: values.name }),
        variant: 'success',
      })
      await onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan'
      setServerError(msg)
      toast({
        title: t('common.toastFailedTitle'),
        description: msg,
        variant: 'error',
      })
    }
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('shifts.sheetCreateTitle')}</SheetTitle>
        <SheetDescription>
          {t('shifts.sheetCreateDesc', { branch: branchName })}
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('shifts.fieldName')}
            </label>
            <Input
              {...form.register('name')}
              placeholder={t('shifts.fieldNamePlaceholder')}
              autoFocus
            />
            {form.formState.errors.name && (
              <p className="mt-1 text-xs text-danger-600">
                {form.formState.errors.name.message}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              {t('shifts.fieldNameHint')}
            </p>
          </div>
          {serverError && (
            <p className="text-sm text-danger-600">{serverError}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="brand"
            loading={form.formState.isSubmitting}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

// ─── Edit sheet (rename + toggle active + delete) ───

const editShiftSchema = z.object({
  name: z.string().min(1).max(50),
  isActive: z.boolean(),
})
type EditShiftForm = z.infer<typeof editShiftSchema>

function EditShiftSheet({
  shift,
  onClose,
  onSaved,
  onDeleted,
}: {
  shift: Shift
  onClose: () => void
  onSaved: () => void | Promise<void>
  onDeleted: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [serverError, setServerError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const form = useForm<EditShiftForm>({
    resolver: zodResolver(editShiftSchema),
    defaultValues: { name: shift.name, isActive: shift.isActive },
  })

  async function handleSubmit(values: EditShiftForm) {
    setServerError(null)
    try {
      await updateShift({
        data: { id: shift.id, name: values.name, isActive: values.isActive },
      })
      toast({
        title: t('common.toastSavedTitle'),
        description: t('shifts.toastUpdated', { name: values.name }),
        variant: 'success',
      })
      await onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan'
      setServerError(msg)
      toast({
        title: t('common.toastFailedTitle'),
        description: msg,
        variant: 'error',
      })
    }
  }

  async function handleDelete() {
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      await deleteShift({ data: { id: shift.id } })
      toast({
        title: t('common.toastDeletedTitle'),
        description: t('shifts.toastDeleted', { name: shift.name }),
        variant: 'success',
      })
      await onDeleted()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghapus'
      setDeleteError(msg)
      toast({
        title: t('common.toastFailedTitle'),
        description: msg,
        variant: 'error',
      })
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{shift.name}</SheetTitle>
        <SheetDescription>{t('shifts.sheetEditDesc')}</SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('shifts.fieldName')}
            </label>
            <Input {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="mt-1 text-xs text-danger-600">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                {...form.register('isActive')}
                className="h-4 w-4"
              />
              {t('shifts.fieldIsActive')}
            </label>
            <p className="mt-1 text-xs text-gray-500">
              {t('shifts.fieldIsActiveHint')}
            </p>
          </div>
          {serverError && (
            <p className="text-sm text-danger-600">{serverError}</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDeleting(true)}
            className="text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-900/30"
          >
            <Trash2 className="h-4 w-4" />
            {t('common.delete')}
          </Button>
          <div className="flex gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="brand"
              loading={form.formState.isSubmitting}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={deleting}
        onConfirm={handleDelete}
        onCancel={() => {
          setDeleting(false)
          setDeleteError(null)
        }}
        title={t('shifts.deleteTitle')}
        description={
          deleteError ?? t('shifts.deleteDesc', { name: shift.name })
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        loading={deleteLoading}
        variant="danger"
      />
    </Sheet>
  )
}

// ─── Edit schedule sheet (weekly grid) ──────────────

const scheduleFormSchema = z.object({
  days: z
    .array(
      z
        .object({
          dayOfWeek: z.number(),
          isWorkDay: z.boolean(),
          clockInTime: z.string().regex(/^\d{2}:\d{2}$/),
          clockOutTime: z.string().regex(/^\d{2}:\d{2}$/),
          lateGraceMinutes: z.coerce.number().int().min(0).max(120),
          earlyLeaveGraceMinutes: z.coerce.number().int().min(0).max(120),
        })
        .refine(
          (d) =>
            !d.isWorkDay ||
            (d.clockInTime.length > 0 &&
              d.clockOutTime.length > 0 &&
              d.clockOutTime > d.clockInTime),
          {
            message:
              'Jam pulang harus setelah jam masuk (shift lintas tengah malam belum didukung).',
            path: ['clockOutTime'],
          },
        ),
    )
    .length(7),
})
type ScheduleForm = z.infer<typeof scheduleFormSchema>

const DAY_LABEL_KEYS = [
  'branches.daySun',
  'branches.dayMon',
  'branches.dayTue',
  'branches.dayWed',
  'branches.dayThu',
  'branches.dayFri',
  'branches.daySat',
]

function EditShiftScheduleSheet({
  shift,
  onClose,
  onSaved,
}: {
  shift: Shift
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<ScheduleForm>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        dayOfWeek: d,
        isWorkDay: false,
        clockInTime: '08:00',
        clockOutTime: '17:00',
        lateGraceMinutes: 10,
        earlyLeaveGraceMinutes: 0,
      })),
    },
  })

  const { fields } = useFieldArray({
    control: form.control,
    name: 'days',
  })

  // Load current schedule on mount
  useEffect(() => {
    getShiftWithSchedule({ data: { shiftId: shift.id } })
      .then(({ schedules }) => {
        if (schedules.length === 7) {
          form.reset({
            days: schedules.map((s) => ({
              dayOfWeek: s.dayOfWeek,
              isWorkDay: s.isWorkDay,
              clockInTime: s.clockInTime?.slice(0, 5) ?? '08:00',
              clockOutTime: s.clockOutTime?.slice(0, 5) ?? '17:00',
              lateGraceMinutes: s.lateGraceMinutes,
              earlyLeaveGraceMinutes: s.earlyLeaveGraceMinutes,
            })),
          })
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift.id])

  async function handleSubmit(values: ScheduleForm) {
    setServerError(null)
    try {
      await setShiftSchedule({
        data: {
          shiftId: shift.id,
          days: values.days.map((d) => ({
            dayOfWeek: d.dayOfWeek,
            isWorkDay: d.isWorkDay,
            // Send null for non-working days so the DB CHECK constraint
            // passes without forcing dummy times.
            clockInTime: d.isWorkDay ? `${d.clockInTime}:00` : null,
            clockOutTime: d.isWorkDay ? `${d.clockOutTime}:00` : null,
            lateGraceMinutes: Number(d.lateGraceMinutes) || 0,
            earlyLeaveGraceMinutes: Number(d.earlyLeaveGraceMinutes) || 0,
          })),
        },
      })
      toast({
        title: t('common.toastSavedTitle'),
        description: t('shifts.toastScheduleSaved', { name: shift.name }),
        variant: 'success',
      })
      await onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan'
      setServerError(msg)
      toast({
        title: t('common.toastFailedTitle'),
        description: msg,
        variant: 'error',
      })
    }
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {t('shifts.scheduleTitle', { name: shift.name })}
        </SheetTitle>
        <SheetDescription>{t('shifts.scheduleDesc')}</SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          <p className="text-xs text-gray-500">{t('shifts.scheduleHint')}</p>
          {fields.map((field, idx) => {
            const isWorkDay = form.watch(`days.${idx}.isWorkDay`)
            const fieldErrs = form.formState.errors.days?.[idx]
            return (
              <div
                key={field.id}
                className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {t(DAY_LABEL_KEYS[field.dayOfWeek] ?? '')}
                  </p>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      {...form.register(`days.${idx}.isWorkDay`)}
                      className="h-4 w-4"
                    />
                    {t('branches.colWorkDay')}
                  </label>
                </div>
                <div
                  className={`space-y-3 ${
                    isWorkDay ? '' : 'pointer-events-none opacity-50'
                  }`}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                        {t('branches.colClockIn')}
                      </label>
                      <Input
                        type="time"
                        {...form.register(`days.${idx}.clockInTime`)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                        {t('branches.colClockOut')}
                      </label>
                      <Input
                        type="time"
                        {...form.register(`days.${idx}.clockOutTime`)}
                      />
                      {fieldErrs?.clockOutTime && (
                        <p className="mt-1 text-xs text-danger-600">
                          {fieldErrs.clockOutTime.message}
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                      {t('branches.colGrace')}
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={120}
                      {...form.register(`days.${idx}.lateGraceMinutes`, {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                </div>
              </div>
            )
          })}
          {serverError && (
            <p className="text-sm text-danger-600">{serverError}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="brand"
            loading={form.formState.isSubmitting}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
