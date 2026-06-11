/**
 * Footer — small "Powered by Vintra" stamp at the very bottom.
 * System-managed: always exists, always last, can't be removed. We
 * keep it as a section anyway so the rendering pipeline doesn't need
 * special cases.
 */
import { Sparkles } from 'lucide-react'
import type { SectionDef } from '../v2-types'

export const footerSection: SectionDef = {
  type: 'footer',
  name: 'Footer',
  description: 'Branding Vintra di paling bawah halaman.',
  icon: 'Sparkles',
  allowMultiple: false,
  systemManaged: true,
  defaultSettings: {},
  fields: [],
  Render: () => (
    <footer className="border-t border-gray-100 bg-white py-8 text-center dark:border-gray-800 dark:bg-gray-900">
      <a
        href="https://vintra.my.id"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand-600 dark:hover:text-brand-400"
      >
        <Sparkles className="h-3 w-3" />
        Powered by Vintra
      </a>
    </footer>
  ),
}
