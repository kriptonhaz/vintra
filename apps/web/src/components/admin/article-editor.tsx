import { useState } from 'react'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, ImagePlus, Trash2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { RichTextEditor } from './rich-text-editor'
import {
  createArticle,
  updateArticle,
  publishArticle,
  unpublishArticle,
  archiveArticle,
  uploadArticleImageFn,
} from '@/server/functions/articles'

export interface ArticleEditorData {
  id: string
  slug: string
  title: string
  excerpt: string | null
  content: string
  coverImageKey: string | null
  category: string | null
  status: string
  seoTitle: string | null
  seoDescription: string | null
  viewCount: number
}

const STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Draft', variant: 'outline' },
  published: { label: 'Terbit', variant: 'success' },
  archived: { label: 'Arsip', variant: 'warning' },
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Gagal membaca file'))
    reader.readAsDataURL(file)
  })
}

export function ArticleEditor({ article }: { article: ArticleEditorData | null }) {
  const navigate = useNavigate()
  const router = useRouter()
  const { toast } = useToast()

  const [title, setTitle] = useState(article?.title ?? '')
  const [slug, setSlug] = useState(article?.slug ?? '')
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? '')
  const [category, setCategory] = useState(article?.category ?? '')
  const [seoTitle, setSeoTitle] = useState(article?.seoTitle ?? '')
  const [seoDescription, setSeoDescription] = useState(article?.seoDescription ?? '')
  const [coverImageKey, setCoverImageKey] = useState(article?.coverImageKey ?? '')
  const [content, setContent] = useState(article?.content ?? '')

  const [saving, setSaving] = useState(false)
  const [busyStatus, setBusyStatus] = useState(false)
  const [coverUploading, setCoverUploading] = useState(false)

  const status = article?.status ?? 'draft'
  const statusMeta = STATUS_META[status] ?? STATUS_META.draft!

  async function uploadImage(file: File): Promise<string> {
    const dataUrl = await fileToDataUrl(file)
    const res = await uploadArticleImageFn({ data: { dataUrl } })
    return res.url
  }

  async function handleCoverPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setCoverUploading(true)
    try {
      const dataUrl = await fileToDataUrl(file)
      const res = await uploadArticleImageFn({ data: { dataUrl } })
      setCoverImageKey(res.mediaId)
    } catch (err) {
      toast({
        title: 'Gagal mengunggah sampul',
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      })
    } finally {
      setCoverUploading(false)
    }
  }

  async function handleSave() {
    if (!title.trim()) {
      toast({ title: 'Judul wajib diisi', variant: 'error' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        slug: slug.trim() || undefined,
        excerpt: excerpt.trim() || undefined,
        content,
        coverImageKey: coverImageKey || null,
        category: category.trim() || null,
        seoTitle: seoTitle.trim() || null,
        seoDescription: seoDescription.trim() || null,
      }
      if (article) {
        await updateArticle({ data: { id: article.id, ...payload } })
        toast({ title: 'Artikel disimpan', variant: 'success' })
        router.invalidate()
      } else {
        const res = await createArticle({ data: payload })
        toast({ title: 'Artikel dibuat', variant: 'success' })
        navigate({
          to: '/admin/articles/$articleId',
          params: { articleId: res.id },
        })
      }
    } catch (err) {
      toast({
        title: 'Gagal menyimpan',
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  async function runStatusAction(
    fn: typeof publishArticle,
    okMessage: string,
  ) {
    if (!article) return
    setBusyStatus(true)
    try {
      await fn({ data: { id: article.id } })
      toast({ title: okMessage, variant: 'success' })
      router.invalidate()
    } catch (err) {
      toast({
        title: 'Gagal mengubah status',
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      })
    } finally {
      setBusyStatus(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          to="/admin/articles"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" /> Artikel
        </Link>
        <div className="flex-1" />
        {article && <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>}
        {article && status === 'published' && (
          <a
            href={`/artikel/${article.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
          >
            Lihat <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <Button variant="brand" loading={saving} onClick={handleSave}>
          Simpan
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-4 lg:col-span-2">
          <Input
            label="Judul"
            placeholder="Judul artikel"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Isi artikel
            </label>
            <RichTextEditor
              value={content}
              onChange={setContent}
              onImageUpload={uploadImage}
            />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Status actions */}
          {article && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <p className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
                Status
              </p>
              <div className="flex flex-col gap-2">
                {status !== 'published' && (
                  <Button
                    variant="brand"
                    size="sm"
                    loading={busyStatus}
                    onClick={() => runStatusAction(publishArticle, 'Artikel diterbitkan')}
                  >
                    Terbitkan
                  </Button>
                )}
                {status === 'published' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busyStatus}
                    onClick={() =>
                      runStatusAction(unpublishArticle, 'Artikel jadi draft')
                    }
                  >
                    Jadikan Draft
                  </Button>
                )}
                {status !== 'archived' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busyStatus}
                    onClick={() => runStatusAction(archiveArticle, 'Artikel diarsipkan')}
                  >
                    Arsipkan
                  </Button>
                )}
                {status === 'archived' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busyStatus}
                    onClick={() => runStatusAction(unpublishArticle, 'Artikel dipulihkan')}
                  >
                    Pulihkan ke Draft
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Dilihat {article.viewCount}×
              </p>
            </div>
          )}

          {/* Cover image */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <p className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Gambar Sampul
            </p>
            {coverImageKey ? (
              <div className="space-y-2">
                <img
                  src={`/artikel/media/${coverImageKey}`}
                  alt="Sampul"
                  className="aspect-video w-full rounded-lg border border-gray-200 object-cover dark:border-gray-700"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCoverImageKey('')}
                >
                  <Trash2 className="h-4 w-4" /> Hapus sampul
                </Button>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 dark:border-gray-600 dark:text-gray-400">
                <ImagePlus className="h-6 w-6" />
                {coverUploading ? 'Mengunggah…' : 'Pilih gambar'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={coverUploading}
                  onChange={handleCoverPick}
                />
              </label>
            )}
          </div>

          {/* Metadata */}
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <Input
              label="Kategori"
              placeholder="mis. Panduan POS"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <Input
              label="Slug URL"
              placeholder="otomatis dari judul"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
            <Textarea
              label="Ringkasan"
              placeholder="Ringkasan singkat untuk kartu daftar artikel"
              rows={3}
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
            />
          </div>

          {/* SEO */}
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              SEO
            </p>
            <Input
              label="Judul SEO"
              placeholder="Default: judul artikel"
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
            />
            <Textarea
              label="Deskripsi SEO"
              placeholder="Default: ringkasan"
              rows={2}
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
