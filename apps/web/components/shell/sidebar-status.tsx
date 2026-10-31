'use client'

import { cn, ConnectionState, focusRing, Tooltip } from '@fenwira/ui'
import { Wallet } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '../session/session-provider'
import {
  connectionSummary,
  formatMoney,
  useConnections,
  useWorkspaceStatus,
} from '@/lib/workspace-status'

const row = cn(
  'flex h-9 w-full items-center gap-2 rounded-sm px-3 text-sm text-fg-secondary hover:bg-surface-hover hover:text-fg',
  focusRing,
  'focus-visible:outline-offset-0',
)

/**
 * Persistent, restrained workspace status at the foot of the sidebar: the WhatsApp connection and,
 * when billing is enforced, the wallet state from the billing domain (UX_PATTERNS → Application
 * shell, P11-D12). Amounts appear only for members who can view billing.
 */
export function SidebarStatus({ collapsed = false }: { collapsed?: boolean }) {
  const { can, me } = useSession()
  const connections = useConnections()
  const status = useWorkspaceStatus()
  const conn = connectionSummary(connections.data)
  const wallet = status.data?.wallet
  const items: Array<{ key: string; href: string; label: string; node: React.ReactNode }> = []
  if (can('whatsapp.read') && connections.data) {
    const label =
      conn.status === 'NONE'
        ? 'WhatsApp not connected'
        : `WhatsApp ${conn.name ?? ''}: ${conn.status.toLowerCase()}`
    items.push({
      key: 'whatsapp',
      href: '/integrations/whatsapp',
      label,
      node: collapsed ? (
        <ConnectionState status={conn.status} variant="compact" className="sr-only" />
      ) : (
        <ConnectionState status={conn.status} name="WhatsApp" variant="compact" />
      ),
    })
  }
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
        <span className="inline-flex min-w-0 items-center gap-2">
          <Wallet
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0',
              wallet.state === 'NORMAL' ? 'text-fg-secondary' : 'text-status-warning',
            )}
          />
          {collapsed ? (
            <span className="sr-only">{text}</span>
          ) : (
            <span className="truncate">{text}</span>
          )}
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
          {collapsed ? (
            <Tooltip content={i.label} side="right">
              <Link href={i.href} className={cn(row, 'justify-center px-0')}>
                {i.key === 'whatsapp' ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-2.5 rounded-full',
                      conn.status === 'CONNECTED'
                        ? 'bg-status-success'
                        : conn.status === 'NONE'
                          ? 'bg-fg-subtle'
                          : conn.status === 'FLAGGED'
                            ? 'bg-status-warning'
                            : 'bg-status-error',
                    )}
                  />
                ) : null}
                {i.node}
              </Link>
            </Tooltip>
          ) : (
            <Link href={i.href} className={row}>
              {i.node}
            </Link>
          )}
        </li>
      ))}
    </ul>
  )
}
