import { cn } from '@/lib/utils'

interface FormFieldProps {
  label: string
  error?: string
  description?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}

export function FormField({
  label,
  error,
  description,
  required,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-danger-500">*</span>}
      </label>

      {children}

      {description && !error && (
        <p className="text-xs text-gray-500">{description}</p>
      )}

      {error && (
        <p className="text-xs text-danger-500" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
