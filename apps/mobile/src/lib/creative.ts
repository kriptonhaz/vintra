/**
 * Creative module hooks — Studio (combined gallery), Konten (AI image
 * gen), Logo, Spanduk (banner). All Komplit-tier features that consume
 * a tenant credit ledger.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

// ─── Konten ───────────────────────────────────────────────────────

export interface KontenLedger {
  monthlyCap: number | null
  used: number
  remaining: number | null
  periodEnd: string | null
}

export interface KontenStatus {
  enabled: boolean
  tier: string
  message?: string | null
}

export interface KontenPromptConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields: any
}

export interface KontenImage {
  id: string
  prompt: string
  thumbnailUrl: string | null
  fullUrl: string | null
  createdAt: string
}

export function useKontenLedger() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['creative', 'konten-ledger', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<KontenLedger>('getMyKontenLedger', {}, { tenantId }),
  })
}

export function useKontenStatus() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['creative', 'konten-status', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<KontenStatus>('getKontenStatus', {}, { tenantId }),
  })
}

export function useKontenConfig() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['creative', 'konten-config', tenantId],
    enabled: !!tenantId,
    staleTime: 30 * 60 * 1000,
    queryFn: () =>
      callServerFn<KontenPromptConfig>(
        'getKontenPromptConfig',
        {},
        { tenantId },
      ),
  })
}

function inv(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['creative'] })
}

export function useKontenImages() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['creative', 'konten-images', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<KontenImage[]>('listKontenImages', {}, { tenantId }),
  })
}

export function useGenerateKonten() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      prompt: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fields?: any
    }) =>
      callServerFn<KontenImage>('generateKontenImage', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useDeleteKontenImage() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteKontenImage',
        { id },
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useKontenDownloadUrl(id: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['creative', 'konten-dl', tenantId, id],
    enabled: !!tenantId && !!id,
    queryFn: () =>
      callServerFn<{ url: string }>(
        'getKontenImageDownloadUrl',
        { id },
        { tenantId },
      ),
  })
}

// ─── Logo ────────────────────────────────────────────────────────

export interface LogoStatus {
  enabled: boolean
  monthlyCap: number | null
  used: number
  message?: string | null
}

export interface LogoRow {
  id: string
  prompt: string
  thumbnailUrl: string | null
  fullUrl: string | null
  createdAt: string
}

export function useLogoStatus() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['creative', 'logo-status', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<LogoStatus>('getLogoStatus', {}, { tenantId }),
  })
}

export function useLogoConfig() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['creative', 'logo-config', tenantId],
    enabled: !!tenantId,
    staleTime: 30 * 60 * 1000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryFn: () => callServerFn<any>('getLogoPromptConfig', {}, { tenantId }),
  })
}

export function useLogos() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['creative', 'logos', tenantId],
    enabled: !!tenantId,
    queryFn: () => callServerFn<LogoRow[]>('listLogos', {}, { tenantId }),
  })
}

export function useGenerateLogo() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      prompt: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fields?: any
    }) => callServerFn<LogoRow>('generateLogo', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useDeleteLogo() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>('deleteLogo', { id }, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

// ─── Spanduk ─────────────────────────────────────────────────────

export interface SpandukStatus {
  enabled: boolean
  monthlyCap: number | null
  used: number
  message?: string | null
}

export interface SpandukRow {
  id: string
  prompt: string
  thumbnailUrl: string | null
  fullUrl: string | null
  isCommitted: boolean
  createdAt: string
}

export function useSpandukStatus() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['creative', 'spanduk-status', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<SpandukStatus>('getSpandukStatus', {}, { tenantId }),
  })
}

export function useSpandukConfig() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['creative', 'spanduk-config', tenantId],
    enabled: !!tenantId,
    staleTime: 30 * 60 * 1000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryFn: () => callServerFn<any>('getSpandukConfig', {}, { tenantId }),
  })
}

export function useSpanduks() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['creative', 'spanduks', tenantId],
    enabled: !!tenantId,
    queryFn: () => callServerFn<SpandukRow[]>('listSpanduks', {}, { tenantId }),
  })
}

export function useGenerateSpanduk() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      prompt: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fields?: any
    }) => callServerFn<SpandukRow>('generateSpanduk', input, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

export function useCommitSpanduk() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'commitSpandukPreview',
        { id },
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useDeleteSpanduk() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>('deleteSpanduk', { id }, { tenantId }),
    onSuccess: () => inv(qc),
  })
}

// ─── Studio (combined gallery) ────────────────────────────────────

export interface StudioGeneration {
  id: string
  kind: 'konten' | 'logo' | 'spanduk' | string
  prompt: string
  thumbnailUrl: string | null
  fullUrl: string | null
  createdAt: string
}

export function useStudioGenerations(kind?: 'konten' | 'logo' | 'spanduk') {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['creative', 'studio', tenantId, kind ?? 'all'],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<StudioGeneration[]>(
        'listStudioGenerations',
        kind ? { kind } : {},
        { tenantId },
      ),
  })
}

export function useDeleteStudioGeneration() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; kind: string }) =>
      callServerFn<{ success: true }>(
        'deleteStudioGeneration',
        input,
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}
