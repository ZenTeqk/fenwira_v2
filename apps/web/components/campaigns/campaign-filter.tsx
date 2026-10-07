'use client'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@fenwira/ui'

export function CampaignFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<[string, string]>
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-9 w-32">
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
