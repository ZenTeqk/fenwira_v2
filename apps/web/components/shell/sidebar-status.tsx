'use client'

import { cn, focusRing, Tooltip } from '@fenwira/ui'
import { Wallet } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '../session/session-provider'
import { formatMoney, useWorkspaceStatus } from '@/lib/workspace-status'

const row = cn(
  'relative flex h-9 w-full items-center gap-2 rounded-sm px-3 text-sm text-fg-secondary hover:bg-surface-hover hover:text-fg',
  focusRing,
  'focus-visible:outline-offset-0',
)

/**
 * Wallet state from the billing domain (P11-D12). WhatsApp lives beside the workspace switcher.
 */
export function SidebarStatus() {
  const { can, me } = useSession()
  const status = useWorkspaceStatus()
  const wallet = status.data?.wallet
  const items: Array<{ key: string; href: string; label: string; node: React.ReactNode }> = []
  // ADR-0027: no wallet surfaces for customers in Managed Launch (operators manage it).
  if (wallet && wallet.state !== 'NOT_ENFORCED' && !me.features.managedLaunch) {
    const amount =
      wallet.availableMinor === null ? null : formatMoney(wallet.availableMinor, wallet.currency)
    const text =
      wallet.state === 'INSUFFICIENT_FUNDS'
        ? 'No credits'
        : wallet.state === 'LOW_BALANCE'
          ? amount
            ? `Low balance · ${amount}`
            : 'Low balance'
          : amount
            ? `Wallet · ${amount}`
            : 'Wallet'
    items.push({
      key: 'wallet',
      href: can('billing.read') ? '/billing/wallet' : '/dashboard',
      label: text,
      node: (
        <span className="inline-flex min-w-0 items-center gap-3">
          <Wallet
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0',
              wallet.state === 'NORMAL' ? 'text-fg-secondary' : 'text-status-warning',
            )}
          />
          <span className="fw-sidebar-label truncate">{text}</span>
        </span>
      ),
    })
  }
  if (!items.length) return null
  return (
    <ul
      aria-label="Workspace status"
      className="flex flex-col gap-0.5 border-t border-border-subtle pt-3"
    >
      {items.map((i) => (
        <li key={i.key}>
          <Tooltip content={i.label} side="right">
            <Link href={i.href} className={row}>
              {i.node}
            </Link>
          </Tooltip>
        </li>
      ))}
    </ul>
  )
}
