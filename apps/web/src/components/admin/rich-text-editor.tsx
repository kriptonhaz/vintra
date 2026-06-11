import { useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Image as ImageIcon,
  Undo2,
  Redo2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface RichTextEditorProps {
  /** Initial HTML — read once on mount; the editor owns state after. */
  value: string
  onChange: (html: string) => void
  /** Uploads a picked file, resolves to the public image URL to embed. */
  onImageUpload: (file: File) => Promise<string>
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md text-gray-600 transition-colors',
        'hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700',
        active && 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400',
      )}
    >
      {children}
    </button>
  )
}

function Toolbar({
  editor,
  onPickImage,
  uploading,
}: {
  editor: Editor
  onPickImage: () => void
  uploading: boolean
}) {
  function setLink() {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('URL tautan', previous ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: url })
      .run()
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 px-2 py-1.5 dark:border-gray-700">
      <ToolbarButton
        title="Tebal"
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        title="Miring"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        title="Garis bawah"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive('underline')}
      >
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        title="Coret"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')}
      >
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
      <ToolbarButton
        title="Judul"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
      >
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        title="Sub-judul"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}
      >
        <Heading3 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        title="Daftar"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        title="Daftar bernomor"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        title="Kutipan"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
      >
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
      <ToolbarButton title="Tautan" onClick={setLink} active={editor.isActive('link')}>
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Gambar" onClick={onPickImage} disabled={uploading}>
        <ImageIcon className="h-4 w-4" />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
      <ToolbarButton
        title="Batalkan"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        title="Ulangi"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>
    </div>
  )
}

export function RichTextEditor({
  value,
  onChange,
  onImageUpload,
}: RichTextEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const editor = useEditor({
    // Required for SSR frameworks — render the editor only after mount
    // so server and client markup match.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: false }),
      Image,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'article-prose min-h-[320px] px-4 py-3 focus:outline-none',
      },
    },
  })

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !editor) return
    setUploading(true)
    try {
      const url = await onImageUpload(file)
      editor.chain().focus().setImage({ src: url }).run()
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800">
      {editor && (
        <Toolbar
          editor={editor}
          uploading={uploading}
          onPickImage={() => fileRef.current?.click()}
        />
      )}
      <EditorContent editor={editor} />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  )
}
