import { cn } from '@fenwira/ui'
import { Fragment } from 'react'

const PART = /(\{\{\s*\d+\s*\}\})/g

/**
 * Text with `{{n}}` variables rendered as chips (docs/DESIGN_SYSTEM.md → variable chips:
 * primary-soft with -strong text, since plain primary fails AA as text). With `values`, a chip
 * shows the value and keeps the variable in its title.
 */
export function VariableText({
  text,
  values,
  className,
}: {
  text: string
  values?: readonly (string | undefined)[]
  className?: string
}) {
  return (
    <span className={cn('whitespace-pre-wrap break-words', className)}>
      {text.split(PART).map((part, i) => {
        const m = /^\{\{\s*(\d+)\s*\}\}$/.exec(part)
        if (!m) return <Fragment key={i}>{part}</Fragment>
        const value = values?.[Number(m[1]) - 1]
        return (
          <span
            key={i}
            title={value ? `{{${m[1]}}}` : undefined}
            className="mx-px rounded-sm bg-primary-soft px-1 font-medium text-primary-strong"
          >
            {value || `{{${m[1]}}}`}
          </span>
        )
      })}
    </span>
  )
}
