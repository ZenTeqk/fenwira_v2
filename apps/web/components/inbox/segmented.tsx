import { cn } from '@fenwira/ui'

/** A row of toggle buttons for switching a view (no tab panels involved, so not ARIA tabs). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-md bg-neutral-soft p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'shrink-0 rounded-sm px-2.5 py-1 text-sm font-medium text-slate transition-colors',
            o.value === value ? 'bg-surface shadow-raised' : 'hover:bg-surface/60',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
