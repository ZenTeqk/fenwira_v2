'use client'

import { Avatar as AvatarPrimitive } from 'radix-ui'
import { cn } from '../lib/cn'

const sizes = { sm: 'size-6 text-xs', md: 'size-8 text-sm', lg: 'size-10 text-base' } as const

export type AvatarProps = {
  name: string
  src?: string
  size?: keyof typeof sizes
  /** Opt-in human identity palette; other surfaces keep their established default. */
  appearance?: 'default' | 'varied' | 'inbox'
  /** Stable contact ID when names change or are shared by several contacts. */
  identityKey?: string
  /** Optional visible fallback (for example a generated contact's distinguishing number). */
  fallbackLabel?: string
  className?: string
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters =
    parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [parts[0]?.[0], parts[0]?.[1]]
  return letters.filter(Boolean).join('').toUpperCase() || '?'
}

const identityTones = [
  'bg-action-primary-subtle text-action-primary',
  'bg-status-info-bg text-status-info-fg',
  'bg-status-warning-bg text-status-warning-fg',
  'bg-status-error-bg text-status-error-fg',
  'bg-status-success-bg text-status-success-fg',
] as const

const inboxTones = [
  'bg-avatar-pink-bg text-avatar-pink-fg',
  'bg-avatar-lavender-bg text-avatar-lavender-fg',
  'bg-avatar-peach-bg text-avatar-peach-fg',
  'bg-avatar-mint-bg text-avatar-mint-fg',
  'bg-avatar-periwinkle-bg text-avatar-periwinkle-fg',
] as const

/** Stable across renders/server hydration. Color is decorative identity, never a status. */
export function avatarTone(name: string, appearance: 'varied' | 'inbox' = 'varied'): string {
  let hash = 0
  for (const char of name.trim().toLocaleLowerCase('en'))
    hash = (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0
  const tones = appearance === 'inbox' ? inboxTones : identityTones
  return tones[hash % tones.length]!
}

export function Avatar({
  name,
  src,
  size = 'md',
  appearance = 'default',
  identityKey,
  fallbackLabel,
  className,
}: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden rounded-full',
        sizes[size],
        className,
      )}
    >
      {src ? (
        <AvatarPrimitive.Image src={src} alt={name} className="size-full object-cover" />
      ) : null}
      <AvatarPrimitive.Fallback
        className={cn(
          'flex size-full items-center justify-center font-medium',
          appearance !== 'default'
            ? avatarTone(identityKey ?? name, appearance)
            : 'bg-surface-selected text-fg',
        )}
        aria-label={name}
      >
        {fallbackLabel ?? initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
