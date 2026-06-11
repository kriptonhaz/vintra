import * as React from 'react'
import { cn } from '@/lib/utils'
import { formatRupiah } from '@/lib/currency'

interface CurrencyInputProps {
  value: string
  onChange: (value: string) => void
  label?: string
  error?: string
  placeholder?: string
  disabled?: boolean
  id?: string
  className?: string
}

const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  (
    {
      value,
      onChange,
      label,
      error,
      placeholder = 'Rp 0',
      disabled,
      id,
      className,
    },
    ref,
  ) => {
    const inputId = id || React.useId()

    // `value` is a raw numeric string (digits, optionally with a decimal
    // point from a DB numeric column). Parse it as a number directly —
    // do NOT strip "." as a thousand separator, that mangles "6000.00".
    const numericValue = Number(value) || 0
    const displayValue = numericValue > 0 ? formatRupiah(numericValue) : ''

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value
      // Strip non-numeric characters and pass back as string
      const cleaned = raw.replace(/[^\d]/g, '')
      onChange(cleaned)
    }

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 dark:text-gray-400">
            Rp
          </span>
          <input
            ref={ref}
            id={inputId}
            type="text"
            inputMode="numeric"
            value={displayValue ? displayValue.replace(/^Rp\s?/, '') : ''}
            onChange={handleChange}
            placeholder={placeholder.replace(/^Rp\s?/, '')}
            disabled={disabled}
            className={cn(
              'flex h-10 w-full rounded-lg border bg-white pl-9 pr-3 py-2 text-sm dark:bg-gray-800',
              'placeholder:text-gray-400 dark:placeholder:text-gray-500',
              'focus:outline-none focus:ring-2 focus:ring-offset-0',
              'disabled:cursor-not-allowed disabled:opacity-50',
              error
                ? 'border-danger-500 focus:ring-danger-500/25'
                : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500/25 dark:border-gray-600',
              className,
            )}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
          />
        </div>
        {error && (
          <p id={`${inputId}-error`} className="text-sm text-danger-500">
            {error}
          </p>
        )}
      </div>
    )
  },
)
CurrencyInput.displayName = 'CurrencyInput'

export { CurrencyInput, type CurrencyInputProps }
