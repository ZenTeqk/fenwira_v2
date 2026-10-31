'use client'

import {
  Button,
  Dropdown,
  DropdownContent,
  DropdownLabel,
  DropdownRadioGroup,
  DropdownRadioItem,
  DropdownTrigger,
} from '@fenwira/ui'
import { Monitor, Moon, Sun } from 'lucide-react'
import { type ThemePreference, useThemePreference } from '@/lib/theme'

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/** Header Appearance menu: Light, Dark or System (the default when nothing is stored). */
export function AppearanceMenu() {
  const { preference, setPreference } = useThemePreference()
  const current = OPTIONS.find((o) => o.value === (preference ?? 'system'))!
  const Icon = current.icon
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="[&_svg]:size-5"
          aria-label={`Appearance: ${current.label}`}
        >
          <Icon aria-hidden="true" />
        </Button>
      </DropdownTrigger>
      <DropdownContent className="w-44">
        <DropdownLabel>Appearance</DropdownLabel>
        <DropdownRadioGroup
          value={preference ?? 'system'}
          onValueChange={(value) => setPreference(value as ThemePreference)}
        >
          {OPTIONS.map(({ value, label, icon: OptionIcon }) => (
            <DropdownRadioItem key={value} value={value}>
              <OptionIcon aria-hidden="true" />
              {label}
            </DropdownRadioItem>
          ))}
        </DropdownRadioGroup>
      </DropdownContent>
    </Dropdown>
  )
}
