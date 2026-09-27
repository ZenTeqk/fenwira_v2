'use client'

import { cn, ConnectionState, focusRing, Tooltip } from '@fenwira/ui'
import { Wallet } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '../session/session-provider'
import {
  connectionSummary,
  formatMoney,
  useConnections,
  useWallet,
  walletState,
} from '@/lib/workspace-status'

const row = cn(
  'flex h-9 w-full items-center gap-2 rounded-sm px-3 text-sm text-slate-400 hover:bg-slate-800 hover:text-surface',
  focusRing,
  'focus-visible:outline-offset-0',
)

/**
 * Persistent, restrained workspace status at the foot of the sidebar: the WhatsApp connection and,
 * when billing is enforced, the wallet (UX_PATTERNS → Application shell).
 */
export function SidebarStatus({ collapsed = false }: { collapsed?: boolean }) {
  const { can } = useSession()
  const connections = useConnections()
  const wallet = useWallet()
  const conn = connectionSummary(connections.data)
  const ws = walletState(wallet.data)
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
  if (ws !== 'HIDDEN' && wallet.data) {
    const amount = formatMoney(wallet.data.availableMinor, wallet.data.currency)
    const text =
      ws === 'EMPTY'
        ? 'Wallet empty'
        : ws === 'LOW'
          ? `Low balance · ${amount}`
          : `Wallet · ${amount}`
    items.push({
      key: 'wallet',
      href: '/dashboard',
      label: text,
      node: (
        <span className="inline-flex min-w-0 items-center gap-2">
          <Wallet
            aria-hidden="true"
            className={cn('size-4 shrink-0', ws === 'OK' ? 'text-slate-400' : 'text-warning')}
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
      className="flex flex-col gap-0.5 border-t border-slate-800 pt-3"
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
                        ? 'bg-success'
                        : conn.status === 'NONE'
                          ? 'bg-slate-400'
                          : conn.status === 'FLAGGED'
                            ? 'bg-warning'
                            : 'bg-danger',
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
