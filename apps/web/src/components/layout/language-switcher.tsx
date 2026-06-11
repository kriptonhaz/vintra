import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { cn } from '@/lib/utils'

const LANGUAGES = [
  { code: 'id', label: 'Indonesia' },
  { code: 'en', label: 'English' },
] as const

export function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const currentLang = i18n.language?.startsWith('en') ? 'en' : 'id'

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function selectLanguage(code: string) {
    i18n.changeLanguage(code)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
        aria-label="Select language"
      >
        <Globe className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:shadow-gray-900/50">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => selectLanguage(lang.code)}
              className={cn(
                'flex w-full items-center px-3 py-2 text-left text-sm transition-colors',
                currentLang === lang.code
                  ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                  : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700',
              )}
            >
              {lang.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
