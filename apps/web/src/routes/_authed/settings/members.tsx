import { useState, useEffect } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  useForm,
  Controller,
  type UseFormReturn,
  type FieldErrors,
  type Path,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus,
  Trash2,
  Users,
  ClipboardCheck,
  Building2,
  Lock,
  Copy,
  MessageCircle,
  ChevronDown,
} from 'lucide-react'
import {
  listTenantMembers,
  getRolesForAssignment,
  listTenantBranchesForMembers,
  inviteTenantMember,
  updateTenantMemberProfile,
  updateTenantMemberRole,
  setTenantMemberBranches,
  removeTenantMember,
  setTenantMemberWaLogin,
  getTenantSlugForWaLogin,
  getWaLoginAvailability,
  invitePhoneOnlyTenantMember,
  checkInviteEmailMemberships,
} from '@/server/functions/tenant-members'
import {
  isAttendanceManageable,
  getMemberHrProfile,
  upsertMemberStaffProfile,
} from '@/server/functions/attendance-staff'
import { claimPublicSlug } from '@/server/functions/public-tenant'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { PhotoUploadField } from '@/components/inventory/photo-upload-field'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/settings/members')({
  loader: async () => {
    const [members, roles, branches, tenantSlug, waLogin, attendanceManageable] =
      await Promise.all([
        listTenantMembers(),
        getRolesForAssignment(),
        listTenantBranchesForMembers(),
        getTenantSlugForWaLogin(),
        getWaLoginAvailability(),
        isAttendanceManageable(),
      ])
    return {
      members,
      roles,
      branches,
      tenantSlug,
      waLoginAvailable: waLogin.available,
      attendanceManageable,
    }
  },
  component: MembersPage,
})

type Member = Awaited<ReturnType<typeof listTenantMembers>>[number]
type Role = Awaited<ReturnType<typeof getRolesForAssignment>>[number]
type Branch = Awaited<ReturnType<typeof listTenantBranchesForMembers>>[number]

function isIsoDate(v: string | undefined): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

// Shared optional HR fields, spread into both the invite and edit
// schemas. A staff_profile is created/updated only when hrHomeBranchId
// is set — that field is the "this member is attendance staff" trigger.
const hrFormFields = {
  hrHomeBranchId: z.string().optional(),
  hrNik: z.string().optional(),
  hrEmployeeNumber: z.string().optional(),
  hrJoinedDate: z.string().optional(),
  hrBaseSalary: z.string().optional(),
}
type HrFieldValues = {
  hrHomeBranchId?: string
  hrNik?: string
  hrEmployeeNumber?: string
  hrJoinedDate?: string
  hrBaseSalary?: string
}

const inviteSchema = z
  .object({
    // PR 7: two invite modes.
    //   'email'      → traditional path. Email required, phone optional.
    //   'phone-only' → no real email. Phone required; the server fn
    //                  generates a synthetic Supabase email and flips
    //                  wa_login_enabled on for the new member.
    inviteMode: z.enum(['email', 'phone-only']),
    firstName: z.string().min(1, 'Nama depan wajib diisi'),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    jobTitle: z.string().optional(),
    email: z.string().optional(),
    roleId: z.string().uuid('Pilih role'),
    photoDataUrl: z.string().nullable().optional(),
    // JUR-135: branch access. Default mode is 'specific' with the
    // tenant's main branch pre-selected (locked-in by the InviteSheet
    // defaultValues); owner toggles 'all' for full access.
    branchesMode: z.enum(['all', 'specific']),
    branchIds: z.array(z.string().uuid()),
    // Optional HR ("Data Absensi") fields. Filling the home branch
    // turns the member into attendance staff — see upsertMemberStaffProfile.
    ...hrFormFields,
  })
  .refine(
    (v) => v.branchesMode === 'all' || v.branchIds.length >= 1,
    {
      message: 'Pilih minimal 1 cabang atau centang "Semua cabang"',
      path: ['branchIds'],
    },
  )
  .refine((v) => !v.hrHomeBranchId || isIsoDate(v.hrJoinedDate), {
    message: 'Tanggal bergabung wajib diisi',
    path: ['hrJoinedDate'],
  })
  .refine(
    (v) =>
      v.inviteMode !== 'email' || (v.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)),
    { message: 'Email tidak valid', path: ['email'] },
  )
  .refine(
    (v) =>
      v.inviteMode !== 'phone-only' || (v.phone && v.phone.length >= 6),
    {
      message: 'Nomor HP wajib diisi untuk login WhatsApp',
      path: ['phone'],
    },
  )
type InviteForm = z.infer<typeof inviteSchema>

const editProfileSchema = z
  .object({
    firstName: z.string().min(1, 'Nama depan wajib diisi'),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    jobTitle: z.string().optional(),
    photoDataUrl: z.string().nullable().optional(),
    ...hrFormFields,
  })
  .refine((v) => !v.hrHomeBranchId || isIsoDate(v.hrJoinedDate), {
    message: 'Tanggal bergabung wajib diisi',
    path: ['hrJoinedDate'],
  })
type EditProfileForm = z.infer<typeof editProfileSchema>

function fullName(m: Pick<Member, 'firstName' | 'lastName'>): string | null {
  const parts = [m.firstName, m.lastName].filter(Boolean) as string[]
  return parts.length ? parts.join(' ') : null
}

function MembersPage() {
  const { members, roles, branches, tenantSlug, waLoginAvailable, attendanceManageable } =
    Route.useLoaderData()
  const router = useRouter()
  const { t } = useTranslation()
  const [showInvite, setShowInvite] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [pendingRemove, setPendingRemove] = useState<Member | null>(null)
  const [removeLoading, setRemoveLoading] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  // Inline editor for the tenant's public_slug vanity alias on the
  // WA-login URL. Saving calls claimPublicSlug() + invalidates so the
  // loader refetches the new URL.
  const [editingSlug, setEditingSlug] = useState(false)
  const [slugDraft, setSlugDraft] = useState(tenantSlug.publicSlug ?? '')
  const [savingSlug, setSavingSlug] = useState(false)
  const [slugError, setSlugError] = useState<string | null>(null)

  async function handleSaveSlug() {
    const next = slugDraft.trim().toLowerCase()
    if (!next) {
      setSlugError('URL tidak boleh kosong.')
      return
    }
    setSavingSlug(true)
    setSlugError(null)
    try {
      await claimPublicSlug({ data: { slug: next } })
      setEditingSlug(false)
      await router.invalidate()
    } catch (err) {
      setSlugError(err instanceof Error ? err.message : 'Gagal menyimpan URL')
    } finally {
      setSavingSlug(false)
    }
  }

  const assignable = roles.filter((r) => r.key !== 'owner')
  // JUR-135: the Cabang column + branch-access UI only carries weight
  // when a tenant has 2+ branches. Single-branch tenants get the
  // current UX unchanged.
  const showBranchColumn = branches.length > 1

  async function handleToggleWaLogin(member: Member, enabled: boolean) {
    setRowError(null)
    try {
      await setTenantMemberWaLogin({
        data: { memberId: member.id, enabled },
      })
      await router.invalidate()
    } catch (err) {
      setRowError(
        err instanceof Error ? err.message : 'Gagal mengubah login WA',
      )
    }
  }

  async function handleCopyLoginUrl() {
    const url = `${window.location.origin}${tenantSlug.loginUrl}`
    try {
      await navigator.clipboard.writeText(url)
      // Lightweight feedback — replace with toast in PR 7 if we wire it.
      setRowError(null)
    } catch {
      setRowError('Browser tidak mendukung salin otomatis. Salin manual: ' + url)
    }
  }

  async function handleRoleChange(member: Member, roleId: string) {
    setRowError(null)
    try {
      await updateTenantMemberRole({ data: { memberId: member.id, roleId } })
      await router.invalidate()
    } catch (err) {
      setRowError(err instanceof Error ? err.message : t('members.roleChangeError'))
    }
  }

  async function handleRemove() {
    if (!pendingRemove) return
    setRemoveLoading(true)
    setRemoveError(null)
    try {
      await removeTenantMember({ data: { memberId: pendingRemove.id } })
      setPendingRemove(null)
      await router.invalidate()
    } catch (err) {
      setRemoveError(
        err instanceof Error ? err.message : t('members.removeError'),
      )
    } finally {
      setRemoveLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('members.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('members.subtitle')}
          </p>
        </div>
        <Button variant="brand" onClick={() => setShowInvite(true)}>
          <Plus className="h-4 w-4" />
          {t('members.inviteButton')}
        </Button>
      </div>

      {rowError && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-900 dark:bg-danger-900/20 dark:text-danger-400">
          {rowError}
        </div>
      )}

      {/* Tenant-specific WhatsApp login URL. Owner shares this link
          with staff once; staff bookmark it and use it whenever they
          need to log in. The link itself is harmless when WA login is
          disabled at the instance level — the page just shows "Login
          WhatsApp belum aktif". */}
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-900/40 dark:bg-brand-950/30">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-300" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-brand-900 dark:text-brand-200">
                Link Login WhatsApp untuk {tenantSlug.businessName}
              </p>
              {!editingSlug && (
                <p className="mt-0.5 break-all text-xs text-brand-800 dark:text-brand-300">
                  {tenantSlug.loginUrl}
                </p>
              )}
            </div>
          </div>
          {!editingSlug && (
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" onClick={handleCopyLoginUrl}>
                <Copy className="h-4 w-4" />
                Salin link
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSlugDraft(tenantSlug.publicSlug ?? '')
                  setSlugError(null)
                  setEditingSlug(true)
                }}
              >
                Ubah URL
              </Button>
            </div>
          )}
        </div>
        {editingSlug && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 rounded-md border border-brand-300 bg-white px-2 py-1.5 text-sm dark:border-brand-700 dark:bg-gray-900">
                <span className="shrink-0 text-brand-700 dark:text-brand-400">
                  /auth/wa-login/
                </span>
                <input
                  autoFocus
                  value={slugDraft}
                  onChange={(e) => setSlugDraft(e.target.value)}
                  placeholder={tenantSlug.slug}
                  className="min-w-0 flex-1 bg-transparent text-brand-900 outline-none dark:text-brand-100"
                  disabled={savingSlug}
                />
              </div>
              {slugError && (
                <p className="mt-1 text-xs text-danger-600">{slugError}</p>
              )}
              <p className="mt-1 text-xs text-brand-700 dark:text-brand-400">
                Huruf kecil, angka, dan tanda hubung (3–30 karakter).
                Dipakai juga sebagai subdomain situs publik jika tenant
                punya akses situs.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="ghost"
                onClick={() => setEditingSlug(false)}
                disabled={savingSlug}
              >
                Batal
              </Button>
              <Button
                variant="brand"
                onClick={handleSaveSlug}
                loading={savingSlug}
              >
                Simpan
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <Users className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('members.listCount', { count: members.length })}
          </h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('members.colName')}</TableHead>
              <TableHead>{t('members.colJobTitle')}</TableHead>
              <TableHead>{t('members.colPhone')}</TableHead>
              <TableHead>Login WA</TableHead>
              <TableHead>{t('members.colAttendance')}</TableHead>
              <TableHead>{t('members.colRole')}</TableHead>
              {showBranchColumn && (
                <TableHead>{t('members.colBranches')}</TableHead>
              )}
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const name = fullName(m)
              return (
                <TableRow
                  key={m.id}
                  onClick={(e) => {
                    // Don't open the edit sheet when clicking the role
                    // <select> or the remove button.
                    const target = e.target as HTMLElement
                    if (target.closest('button, select, input')) return
                    setEditing(m)
                  }}
                  className="cursor-pointer"
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar src={m.photoUrl} name={name ?? m.email ?? '?'} />
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {name ?? (
                            <span className="italic text-gray-400">
                              {t('members.namePending')}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {m.email ?? t('members.noEmail')}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                    {m.jobTitle ?? <span className="text-gray-400">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                    {m.phone ?? <span className="text-gray-400">—</span>}
                  </TableCell>
                  <TableCell>
                    {m.roleKey === 'owner' ? (
                      // Owners can log in via WA too if they want, but
                      // we don't expose the toggle here — they already
                      // have email/password as the source-of-truth
                      // sign-in. The "Login WA" column is staff-focused.
                      <span className="text-xs text-gray-400">—</span>
                    ) : !m.phone ? (
                      <span
                        className="text-xs text-gray-400"
                        title="Tambahkan nomor HP dulu sebelum mengaktifkan login WA."
                      >
                        Butuh HP
                      </span>
                    ) : m.waLoginEnabled ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleToggleWaLogin(m, false)
                        }}
                        className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300"
                      >
                        <MessageCircle className="h-3 w-3" />
                        Aktif
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleToggleWaLogin(m, true)
                        }}
                        className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                      >
                        Aktifkan
                      </button>
                    )}
                  </TableCell>
                  <TableCell>
                    {m.hasStaffProfile ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                        <ClipboardCheck className="h-3 w-3" />
                        {t('members.staffBadge')}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {m.roleKey === 'owner' ? (
                      <span className="inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
                        {m.roleLabel ?? t('members.ownerRole')}
                      </span>
                    ) : (
                      <Select
                        value={m.roleId ?? ''}
                        onChange={(e) => handleRoleChange(m, e.target.value)}
                        options={assignable.map((r) => ({
                          value: r.id,
                          label: r.label,
                        }))}
                        className="h-8 py-1 text-xs"
                      />
                    )}
                  </TableCell>
                  {showBranchColumn && (
                    <TableCell>
                      <BranchAssignmentCell
                        member={m}
                        branches={branches}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    {m.roleKey !== 'owner' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPendingRemove(m)
                        }}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30"
                        aria-label={t('members.ariaRemove')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {showInvite && (
        <InviteSheet
          roles={assignable}
          branches={branches}
          waLoginAvailable={waLoginAvailable}
          showHrSection={attendanceManageable}
          onClose={() => setShowInvite(false)}
          onInvited={async (opts) => {
            if (!opts?.keepOpen) setShowInvite(false)
            await router.invalidate()
          }}
        />
      )}

      {editing && (
        <EditProfileSheet
          member={editing}
          branches={branches}
          hasMultipleBranches={showBranchColumn}
          showHrSection={attendanceManageable}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await router.invalidate()
          }}
        />
      )}

      <ConfirmDialog
        open={pendingRemove !== null}
        onConfirm={handleRemove}
        onCancel={() => {
          setPendingRemove(null)
          setRemoveError(null)
        }}
        title={t('members.removeTitle')}
        description={
          removeError ??
          (pendingRemove?.email
            ? t('members.removeDesc', { email: pendingRemove.email })
            : t('members.removeFallback'))
        }
        confirmText={t('members.removeCta')}
        cancelText={t('common.cancel')}
        loading={removeLoading}
        variant="danger"
      />
    </div>
  )
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="h-10 w-10 flex-shrink-0 rounded-full object-cover"
      />
    )
  }
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
      {initial}
    </div>
  )
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h3>
        {description && (
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}

// Like FormSection, but the body collapses behind a header toggle.
// Used for the optional "Data Absensi (HR)" block so members not on
// attendance aren't faced with HR fields by default.
function CollapsibleSection({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string
  description?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  // `defaultOpen` can flip to true after an async load (e.g. the edit
  // sheet discovering the member already has a staff profile) — expand
  // when it does, but never force it closed.
  useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
      >
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h3>
          {description && (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {description}
            </p>
          )}
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-gray-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t border-gray-200 p-4 dark:border-gray-700">
          {children}
        </div>
      )}
    </div>
  )
}

// The "Data Absensi (HR)" fields, shared by the invite and edit sheets.
// Generic over the form type — both InviteForm and EditProfileForm carry
// the same `hr*` fields (spread from hrFormFields) so they satisfy the
// HrFieldValues constraint. The casts narrow the form's path/error types
// to the HR subset this component touches.
function HrFields<T extends HrFieldValues>({
  form,
  branches,
}: {
  form: UseFormReturn<T>
  branches: Branch[]
}) {
  const { t } = useTranslation()
  const reg = (name: keyof HrFieldValues) => form.register(name as Path<T>)
  const errs = form.formState.errors as FieldErrors<HrFieldValues>
  return (
    <>
      <Field
        label={t('members.hrHomeBranch')}
        error={errs.hrHomeBranchId?.message}
      >
        <Select
          {...reg('hrHomeBranchId')}
          options={[
            { value: '', label: t('members.hrHomeBranchNone') },
            ...branches.map((b) => ({ value: b.id, label: b.name })),
          ]}
        />
      </Field>
      <p className="-mt-1 text-xs text-gray-500 dark:text-gray-400">
        {t('members.hrHomeBranchHint')}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={t('members.hrJoinedDate')}
          error={errs.hrJoinedDate?.message}
        >
          {/* Custom dd/mm/yyyy input — native type="date" renders
              mm/dd/yyyy on en-US-locale browsers, which Indonesian
              users mis-read. The on-the-wire value is still ISO. */}
          <Controller
            name={'hrJoinedDate' as Path<T>}
            control={form.control}
            render={({ field }) => (
              <DateInput
                value={(field.value as string | undefined) ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
              />
            )}
          />
        </Field>
        <Field label={t('members.hrBaseSalary')}>
          <Input type="number" min={0} step={1000} {...reg('hrBaseSalary')} />
        </Field>
        <Field label={t('members.hrNik')}>
          <Input {...reg('hrNik')} />
        </Field>
        <Field label={t('members.hrEmployeeNumber')}>
          <Input placeholder="E001" {...reg('hrEmployeeNumber')} />
        </Field>
      </div>
    </>
  )
}

function InviteSheet({
  roles,
  branches,
  waLoginAvailable,
  showHrSection,
  onClose,
  onInvited,
}: {
  roles: Role[]
  branches: Branch[]
  waLoginAvailable: boolean
  showHrSection: boolean
  onClose: () => void
  onInvited: (opts?: { keepOpen?: boolean }) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [serverError, setServerError] = useState<string | null>(null)
  // Set after a successful email invite — the Supabase activation link.
  // We show it so the owner can forward it manually as a fallback to the
  // (also-sent) email invitation.
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  // Once the member row is created we keep its id so a retry (e.g. the
  // HR upsert failed on a quota error) doesn't re-invite the member.
  const [createdMemberId, setCreatedMemberId] = useState<string | null>(null)
  // Set when the pre-flight found this email already working somewhere
  // else. Holds the submitted values so the dialog's "Ya, tetap
  // tambahkan" can replay the exact same invite with the flag on.
  const [pendingConfirm, setPendingConfirm] = useState<{
    values: InviteForm
    memberships: Array<{ tenantName: string; roleLabel: string }>
  } | null>(null)
  // The confirmed invite runs outside react-hook-form's handleSubmit, so
  // formState.isSubmitting stays false for it. Track it here or the
  // dialog button sits idle through the whole request and invites a
  // second click.
  const [confirmLoading, setConfirmLoading] = useState(false)

  // JUR-135: per the spec, pre-select the main branch when present
  // (falls back to first branch by createdAt order, which is already
  // how listTenantBranchesForMembers sorts after the isMain DESC).
  // Single-branch tenants don't see the picker at all so the default
  // value still works for them.
  const mainBranch = branches.find((b) => b.isMain) ?? branches[0]
  const hasMultipleBranches = branches.length > 1

  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      inviteMode: 'email',
      firstName: '',
      lastName: '',
      phone: '',
      jobTitle: '',
      email: '',
      roleId: roles[0]?.id ?? '',
      photoDataUrl: null,
      branchesMode: 'specific',
      branchIds: mainBranch ? [mainBranch.id] : [],
      hrHomeBranchId: '',
      hrNik: '',
      hrEmployeeNumber: '',
      hrJoinedDate: new Date().toISOString().slice(0, 10),
      hrBaseSalary: '',
    },
  })

  const inviteMode = form.watch('inviteMode')

  // JUR-135: when the picked role is owner, force the access mode to
  // 'all' (server-side rule). The UI also hides the picker in this
  // case but we re-sync defaults defensively.
  const selectedRoleId = form.watch('roleId')
  const selectedRoleIsOwner =
    roles.find((r) => r.id === selectedRoleId)?.key === 'owner'
  useEffect(() => {
    if (selectedRoleIsOwner) {
      form.setValue('branchesMode', 'all')
      form.setValue('branchIds', [])
    }
  }, [selectedRoleIsOwner, form])

  async function onSubmit(values: InviteForm) {
    setServerError(null)

    // Pre-flight: is this address already a member somewhere else?
    //
    // Only to populate the dialog — the server enforces the same rule
    // and rejects an unconfirmed invite regardless, so a failure here
    // costs nothing but a less specific error message. Skipped once the
    // member row exists (a retry of the HR step, not a new invite) and
    // for phone-only invites, whose synthetic address is unique per
    // tenant and so can never belong to another one.
    if (
      !createdMemberId &&
      values.inviteMode !== 'phone-only' &&
      values.email
    ) {
      try {
        const check = await checkInviteEmailMemberships({
          data: { email: values.email },
        })
        if (check.otherMemberships.length > 0) {
          setPendingConfirm({ values, memberships: check.otherMemberships })
          return
        }
      } catch {
        // Advisory only — fall through and let the server decide.
      }
    }

    await runInvite(values, false)
  }

  async function runInvite(values: InviteForm, confirmedExisting: boolean) {
    setServerError(null)
    try {
      const branchesArg =
        values.branchesMode === 'all'
          ? { mode: 'all' as const }
          : { mode: 'specific' as const, branchIds: values.branchIds }

      let memberId = createdMemberId
      let capturedLink: string | null = null
      if (!memberId) {
        if (values.inviteMode === 'phone-only') {
          // Phone-only path: server generates synthetic Supabase email,
          // creates the user, flips wa_login_enabled on. The photo upload
          // is skipped — the phone-only path is intentionally minimal.
          // Owner can add photo via the edit sheet after invite.
          const member = await invitePhoneOnlyTenantMember({
            data: {
              firstName: values.firstName,
              lastName: values.lastName ?? null,
              phone: values.phone!,
              jobTitle: values.jobTitle ?? null,
              roleId: values.roleId,
              branches: branchesArg,
            },
          })
          memberId = member.id
        } else {
          const member = await inviteTenantMember({
            data: {
              email: values.email!,
              roleId: values.roleId,
              firstName: values.firstName,
              lastName: values.lastName ?? null,
              phone: values.phone ?? null,
              jobTitle: values.jobTitle ?? null,
              photoDataUrl: photoDataUrl ?? null,
              branches: branchesArg,
              confirmExistingMemberships: confirmedExisting,
            },
          })
          memberId = member.id
          capturedLink = member.inviteLink ?? null
        }
        setCreatedMemberId(memberId)
      }

      // HR section — create the staff_profile when a home branch was
      // picked. Done after the member exists; on failure the member is
      // kept (createdMemberId) so a retry only re-runs this step.
      if (values.hrHomeBranchId) {
        await upsertMemberStaffProfile({
          data: {
            memberId,
            homeBranchId: values.hrHomeBranchId,
            nik: values.hrNik || null,
            employeeNumber: values.hrEmployeeNumber || null,
            joinedDate: values.hrJoinedDate!,
            baseSalary: values.hrBaseSalary
              ? Number(values.hrBaseSalary)
              : null,
          },
        })
      }
      if (capturedLink) {
        // Keep the sheet open to show the activation link; still refresh
        // the member list underneath.
        setInviteLink(capturedLink)
        await onInvited({ keepOpen: true })
      } else {
        await onInvited()
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('members.inviteError'))
    }
  }

  // Success view — after an email invite, show the activation link the
  // owner can forward (the invite email is also sent automatically).
  if (inviteLink) {
    return (
      <Sheet open={true} onClose={onClose}>
        <SheetHeader onClose={onClose}>
          <SheetTitle>Anggota ditambahkan</SheetTitle>
          <SheetDescription>
            Undangan sudah dikirim ke email anggota. Kamu juga bisa kirim
            link aktivasi di bawah ini secara manual (mis. lewat WhatsApp).
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Link aktivasi
            </label>
            <textarea
              readOnly
              value={inviteLink}
              rows={3}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full break-all rounded-lg border border-gray-300 px-3 py-2 text-xs dark:border-gray-600 dark:bg-gray-800"
            />
            <p className="text-xs text-gray-500">
              Link berlaku 24 jam. Anggota klik link → buat password → bisa
              langsung login.
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteLink)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                } catch {
                  /* clipboard blocked — owner can select the text */
                }
              }}
            >
              {copied ? 'Tersalin!' : 'Salin link'}
            </Button>
            <Button type="button" variant="brand" onClick={onClose}>
              Selesai
            </Button>
          </div>
        </div>
      </Sheet>
    )
  }

  return (
    <>
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('members.inviteSheetTitle')}</SheetTitle>
        <SheetDescription>{t('members.inviteSheetDesc')}</SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* PR 7: invite mode picker. Phone-only path is for staff who
              don't have an email — common for frontline staff. The server fn
              generates a synthetic Supabase email transparently. */}
          <FormSection title="Tipe Undangan">
            <div className="grid gap-2 sm:grid-cols-2">
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm',
                  inviteMode === 'email'
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                    : 'border-gray-200 dark:border-gray-700',
                )}
              >
                <input
                  type="radio"
                  value="email"
                  className="mt-0.5"
                  {...form.register('inviteMode')}
                />
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    Email + Password
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Untuk anggota yang punya email pribadi.
                  </div>
                </div>
              </label>
              <label
                className={cn(
                  'flex items-start gap-2 rounded-lg border p-3 text-sm',
                  !waLoginAvailable
                    ? 'cursor-not-allowed border-gray-200 opacity-60 dark:border-gray-700'
                    : inviteMode === 'phone-only'
                      ? 'cursor-pointer border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                      : 'cursor-pointer border-gray-200 dark:border-gray-700',
                )}
              >
                <input
                  type="radio"
                  value="phone-only"
                  className="mt-0.5"
                  disabled={!waLoginAvailable}
                  {...form.register('inviteMode')}
                />
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    WhatsApp (tanpa email)
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Untuk karyawan toko — login lewat WhatsApp.
                  </div>
                </div>
              </label>
            </div>
            {!waLoginAvailable && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-warning-50 p-2.5 text-xs text-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
                <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Login via WhatsApp butuh minimal 1 instance WhatsApp yang
                  aktif (terhubung). Hubungkan instance dulu di menu WhatsApp,
                  lalu opsi ini akan terbuka.
                </span>
              </p>
            )}
          </FormSection>

          <FormSection title={t('members.sectionData')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('members.fieldFirstName')}
                required
                error={form.formState.errors.firstName?.message}
              >
                <Input {...form.register('firstName')} />
              </Field>
              <Field label={t('members.fieldLastName')}>
                <Input {...form.register('lastName')} />
              </Field>
              <Field
                label={t('members.fieldPhone')}
                required
                error={form.formState.errors.phone?.message}
              >
                <Input
                  type="tel"
                  placeholder="08123456789"
                  {...form.register('phone')}
                />
              </Field>
              <Field label={t('members.fieldJobTitle')}>
                <Input
                  placeholder={t('members.fieldJobTitlePlaceholder')}
                  {...form.register('jobTitle')}
                />
              </Field>
            </div>
            {inviteMode === 'email' && (
              <Field
                label={t('members.fieldEmail')}
                required
                error={form.formState.errors.email?.message}
              >
                <Input
                  type="email"
                  placeholder={t('members.emailPlaceholder')}
                  {...form.register('email')}
                />
              </Field>
            )}
          </FormSection>

          {inviteMode === 'email' && (
            <FormSection
              title={t('members.sectionPhoto')}
              description={t('members.sectionPhotoDesc')}
            >
              <PhotoUploadField
                value={photoDataUrl}
                onChange={setPhotoDataUrl}
              />
            </FormSection>
          )}

          <FormSection
            title={t('members.sectionAccess')}
            description={t('members.sectionAccessDesc')}
          >
            <Select
              {...form.register('roleId')}
              options={roles.map((r) => ({ value: r.id, label: r.label }))}
              error={form.formState.errors.roleId?.message}
            />
          </FormSection>

          {/* JUR-135: branch-access section. Hidden for single-branch
              tenants (nothing to pick) and for the owner role (always
              unrestricted server-side). */}
          {hasMultipleBranches && !selectedRoleIsOwner && (
            <FormSection
              title={t('members.sectionBranches')}
              description={t('members.sectionBranchesDesc')}
            >
              <Controller
                control={form.control}
                name="branchesMode"
                render={({ field }) => (
                  <BranchAccessPicker
                    mode={field.value}
                    onModeChange={field.onChange}
                    branchIds={form.watch('branchIds')}
                    onBranchIdsChange={(ids) => form.setValue('branchIds', ids)}
                    branches={branches}
                    error={form.formState.errors.branchIds?.message}
                  />
                )}
              />
            </FormSection>
          )}

          {showHrSection && (
            <CollapsibleSection
              title={t('members.hrSectionTitle')}
              description={t('members.hrSectionDesc')}
            >
              <HrFields form={form} branches={branches} />
            </CollapsibleSection>
          )}

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
            {t('members.inviteCta')}
          </Button>
        </div>
      </form>
    </Sheet>
    <ConfirmDialog
      open={pendingConfirm !== null}
      title={t('members.existingTenantTitle')}
      description={
        pendingConfirm
          ? t('members.existingTenantBody', {
              list: pendingConfirm.memberships
                .map((m) => `${m.roleLabel} di ${m.tenantName}`)
                .join(', '),
            })
          : undefined
      }
      confirmText={t('members.existingTenantConfirm')}
      cancelText={t('common.cancel')}
      loading={confirmLoading}
      onCancel={() => setPendingConfirm(null)}
      onConfirm={async () => {
        const pending = pendingConfirm
        if (!pending) return
        setConfirmLoading(true)
        try {
          await runInvite(pending.values, true)
        } finally {
          setConfirmLoading(false)
          setPendingConfirm(null)
        }
      }}
    />
    </>
  )
}

function EditProfileSheet({
  member,
  branches,
  hasMultipleBranches,
  showHrSection,
  onClose,
  onSaved,
}: {
  member: Member
  branches: Branch[]
  hasMultipleBranches: boolean
  showHrSection: boolean
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [serverError, setServerError] = useState<string | null>(null)
  // Whether this member already has a staff_profile. Loaded lazily —
  // when true the home branch becomes required (can't blank it out).
  const [hadProfile, setHadProfile] = useState(false)
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(
    member.photoUrl ?? null,
  )
  // Track whether the photo widget has produced a fresh data URL — we
  // only ship one to the server when the user actually picked a new
  // file. The signed S3 URL we initialised with isn't a data URL.
  const [photoChanged, setPhotoChanged] = useState(false)

  // Branch access — owners always get 'all' server-side, so we hide
  // the section for them entirely. For everyone else we seed from the
  // member's current assignment (null → 'all', array → 'specific').
  const showBranchSection =
    hasMultipleBranches && member.roleKey !== 'owner'
  const [branchMode, setBranchMode] = useState<'all' | 'specific'>(
    member.assignedBranchIds === null ? 'all' : 'specific',
  )
  const [branchIds, setBranchIds] = useState<string[]>(
    member.assignedBranchIds ?? [],
  )
  const [branchError, setBranchError] = useState<string | null>(null)

  const form = useForm<EditProfileForm>({
    resolver: zodResolver(editProfileSchema),
    defaultValues: {
      firstName: member.firstName ?? '',
      lastName: member.lastName ?? '',
      phone: member.phone ?? '',
      jobTitle: member.jobTitle ?? '',
      hrHomeBranchId: '',
      hrNik: '',
      hrEmployeeNumber: '',
      hrJoinedDate: '',
      hrBaseSalary: '',
    },
  })

  // Lazy-load the member's HR profile (if any) to pre-fill the section.
  useEffect(() => {
    if (!showHrSection) return
    getMemberHrProfile({ data: { memberId: member.id } })
      .then((p) => {
        if (p) {
          setHadProfile(true)
          form.setValue('hrHomeBranchId', p.branchId ?? '')
          form.setValue('hrNik', p.nik ?? '')
          form.setValue('hrEmployeeNumber', p.employeeNumber ?? '')
          form.setValue('hrJoinedDate', p.joinedDate)
          form.setValue('hrBaseSalary', p.baseSalary ?? '')
        } else {
          form.setValue(
            'hrJoinedDate',
            new Date().toISOString().slice(0, 10),
          )
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmit(values: EditProfileForm) {
    setServerError(null)
    setBranchError(null)

    // Validate the branch picker before firing any mutation — same
    // rule as the invite form: 'specific' mode needs ≥1 branch.
    if (showBranchSection && branchMode === 'specific' && branchIds.length === 0) {
      setBranchError(t('members.accessAtLeastOne'))
      return
    }

    // A member who already has a staff profile must keep a home branch —
    // blanking it is not how staff status is removed.
    if (showHrSection && hadProfile && !values.hrHomeBranchId) {
      form.setError('hrHomeBranchId', {
        message: t('members.hrHomeBranchRequired'),
      })
      return
    }

    try {
      await updateTenantMemberProfile({
        data: {
          memberId: member.id,
          firstName: values.firstName,
          lastName: values.lastName ?? null,
          phone: values.phone ?? null,
          jobTitle: values.jobTitle ?? null,
          // Only send if the user picked a new photo this session.
          photoDataUrl: photoChanged ? photoDataUrl : null,
        },
      })

      // Branch update is a separate server fn. Only fire when the
      // tenant has >1 branch (otherwise picker isn't rendered) and
      // the draft differs from current truth — saves an unnecessary
      // write when the user only touched their name/photo.
      if (showBranchSection) {
        const currentMode: 'all' | 'specific' =
          member.assignedBranchIds === null ? 'all' : 'specific'
        const currentIds = new Set(member.assignedBranchIds ?? [])
        const draftIds = new Set(branchIds)
        const branchesChanged =
          branchMode !== currentMode ||
          currentIds.size !== draftIds.size ||
          [...draftIds].some((id) => !currentIds.has(id))
        if (branchesChanged) {
          await setTenantMemberBranches({
            data: {
              memberId: member.id,
              branches:
                branchMode === 'all'
                  ? { mode: 'all' }
                  : { mode: 'specific', branchIds },
            },
          })
        }
      }

      // HR section — create/update the staff_profile when a home branch
      // is set. Shift assignment is left to /attendance/shifts.
      if (showHrSection && values.hrHomeBranchId) {
        await upsertMemberStaffProfile({
          data: {
            memberId: member.id,
            homeBranchId: values.hrHomeBranchId,
            nik: values.hrNik || null,
            employeeNumber: values.hrEmployeeNumber || null,
            joinedDate: values.hrJoinedDate!,
            baseSalary: values.hrBaseSalary
              ? Number(values.hrBaseSalary)
              : null,
          },
        })
      }

      await onSaved()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('members.inviteError'))
    }
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{fullName(member) ?? t('members.namePending')}</SheetTitle>
        <SheetDescription>
          {member.email ?? t('members.editDescFallback')}
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <FormSection title={t('members.sectionData')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('members.fieldFirstName')}
                required
                error={form.formState.errors.firstName?.message}
              >
                <Input {...form.register('firstName')} />
              </Field>
              <Field label={t('members.fieldLastName')}>
                <Input {...form.register('lastName')} />
              </Field>
              <Field label={t('members.fieldPhone')}>
                <Input
                  type="tel"
                  placeholder="08123456789"
                  {...form.register('phone')}
                />
              </Field>
              <Field label={t('members.fieldJobTitle')}>
                <Input
                  placeholder={t('members.fieldJobTitlePlaceholder')}
                  {...form.register('jobTitle')}
                />
              </Field>
            </div>
            <Field label={t('members.fieldEmail')}>
              <Input
                type="email"
                value={member.email ?? ''}
                disabled
                className="cursor-not-allowed bg-gray-50 dark:bg-gray-900/50"
              />
              <p className="mt-1 text-xs text-gray-500">
                {t('members.emailReadonlyHint')}
              </p>
            </Field>
          </FormSection>

          <FormSection
            title={t('members.sectionPhoto')}
            description={t('members.sectionPhotoDesc')}
          >
            <PhotoUploadField
              value={photoDataUrl}
              onChange={(next) => {
                setPhotoDataUrl(next)
                setPhotoChanged(true)
              }}
            />
          </FormSection>

          {showBranchSection && (
            <FormSection
              title={t('members.sectionBranches')}
              description={t('members.sectionBranchesDesc')}
            >
              <BranchAccessPicker
                mode={branchMode}
                onModeChange={(m) => {
                  setBranchMode(m)
                  setBranchError(null)
                }}
                branchIds={branchIds}
                onBranchIdsChange={(ids) => {
                  setBranchIds(ids)
                  setBranchError(null)
                }}
                branches={branches}
                error={branchError ?? undefined}
              />
            </FormSection>
          )}

          {showHrSection && (
            <CollapsibleSection
              title={t('members.hrSectionTitle')}
              description={t('members.hrSectionDesc')}
              defaultOpen={hadProfile}
            >
              <HrFields form={form} branches={branches} />
            </CollapsibleSection>
          )}

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

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="ml-0.5 text-danger-600">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
    </div>
  )
}

// ─── JUR-135: branch-access UI ─────────────────────

/**
 * Radio (all/specific) + checkbox list. Reused inside the invite
 * sheet form section AND inside the inline chip editor on the table
 * row. Validates locally: "specific" mode with zero checkboxes shows
 * the error string so the parent form's zod refine can stay simple.
 */
function BranchAccessPicker({
  mode,
  onModeChange,
  branchIds,
  onBranchIdsChange,
  branches,
  error,
}: {
  mode: 'all' | 'specific'
  onModeChange: (mode: 'all' | 'specific') => void
  branchIds: string[]
  onBranchIdsChange: (ids: string[]) => void
  branches: Branch[]
  error?: string
}) {
  const { t } = useTranslation()
  function toggle(id: string) {
    if (branchIds.includes(id)) {
      onBranchIdsChange(branchIds.filter((b) => b !== id))
    } else {
      onBranchIdsChange([...branchIds, id])
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="radio"
            checked={mode === 'all'}
            onChange={() => onModeChange('all')}
            className="h-4 w-4 text-brand-600 focus:ring-brand-500"
          />
          {t('members.accessAll')}
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="radio"
            checked={mode === 'specific'}
            onChange={() => onModeChange('specific')}
            className="h-4 w-4 text-brand-600 focus:ring-brand-500"
          />
          {t('members.accessSpecific')}
        </label>
      </div>

      {mode === 'specific' && (
        <div className="space-y-1.5 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
          {branches.map((b) => (
            <label
              key={b.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50"
            >
              <input
                type="checkbox"
                checked={branchIds.includes(b.id)}
                onChange={() => toggle(b.id)}
                className="h-4 w-4 rounded text-brand-600 focus:ring-brand-500"
              />
              <Building2 className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-gray-900 dark:text-gray-100">{b.name}</span>
              {b.isMain && (
                <span className="ml-auto rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
                  {t('members.mainBranchBadge')}
                </span>
              )}
            </label>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-danger-600">{error}</p>}
    </div>
  )
}

/**
 * The "Cabang" cell on the members table. Display-only — clicking the
 * row opens EditProfileSheet which now owns the branch-picker UI
 * (previously this cell had an inline popover that was cramped).
 *
 * Owner is shown a locked badge; everyone else gets a labelled chip
 * with a tooltip listing the assigned branches.
 */
function BranchAssignmentCell({
  member,
  branches,
}: {
  member: Member
  branches: Branch[]
}) {
  const { t } = useTranslation()

  if (member.roleKey === 'owner') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        title={t('members.accessOwnerAlways')}
      >
        <Lock className="h-3 w-3" />
        {t('members.accessAll')}
      </span>
    )
  }

  const assigned = member.assignedBranchIds
  let chipLabel: string
  if (assigned === null) {
    chipLabel = t('members.accessAll')
  } else if (assigned.length === 1) {
    chipLabel =
      branches.find((b) => b.id === assigned[0])?.name ??
      t('members.unknownBranch')
  } else {
    chipLabel = t('members.accessNBranches', { count: assigned.length })
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
      title={
        assigned && assigned.length > 1
          ? assigned
              .map(
                (id) =>
                  branches.find((b) => b.id === id)?.name ?? '?',
              )
              .join(', ')
          : undefined
      }
    >
      <Building2 className="h-3 w-3" />
      {chipLabel}
    </span>
  )
}
