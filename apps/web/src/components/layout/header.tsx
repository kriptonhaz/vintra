import { Menu } from 'lucide-react'
import { ThemeToggle } from './theme-toggle'
import { LanguageSwitcher } from './language-switcher'
import { BranchSwitcher } from './branch-switcher'
import { NotificationBell } from '@/components/notifications/bell'

interface HeaderProps {
  onMenuToggle: () => void
  title?: string
  actions?: React.ReactNode
  /** Compact mode: header stretches full width and the menu button
   *  stays visible on desktop too (since the desktop sidebar is
   *  suppressed in compact mode). */
  compact?: boolean
}

export function Header({ onMenuToggle, title, actions, compact }: HeaderProps) {
  return (
    <header
      className={
        compact
          ? 'fixed top-0 right-0 left-0 z-20 flex h-16 items-center gap-2 border-b border-gray-200 bg-white px-4 dark:border-gray-700 dark:bg-gray-800 sm:gap-4 sm:px-6'
          : 'fixed top-0 right-0 left-0 z-20 flex h-16 items-center gap-2 border-b border-gray-200 bg-white px-4 dark:border-gray-700 dark:bg-gray-800 sm:gap-4 sm:px-6 lg:left-64'
      }
    >
      {/* Menu button — always visible in compact mode (desktop
          sidebar is collapsed there); mobile-only otherwise. */}
      <button
        type="button"
        onClick={onMenuToggle}
        className={
          compact
            ? 'rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200'
            : 'rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200 lg:hidden'
        }
        aria-label="Buka menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Page title */}
      <div className="flex min-w-0 shrink items-center">
        {title && (
          <h1 className="text-lg font-semibold text-gray-900 truncate dark:text-gray-100">{title}</h1>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right section: branch + actions + language + theme + bell */}
      <div className="flex shrink-0 items-center gap-1">
        <BranchSwitcher />
        {actions}
        <LanguageSwitcher />
        <ThemeToggle />
        <NotificationBell />
      </div>
    </header>
  )
}
