'use client'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@fenwira/ui'

export function CampaignFilter({
  label,
  value,
  onChange,
  options,
  wide = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<[string, string]>
  wide?: boolean
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={wide ? 'h-9 w-40 whitespace-nowrap' : 'h-9 w-32'}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([id, name]) => (
          <SelectItem key={id} value={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
