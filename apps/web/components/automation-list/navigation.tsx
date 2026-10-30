import { cn } from '@fenwira/ui'
import Link from 'next/link'
export function AutomationNavigation({
  active = 'workflows',
  counts,
}: {
  active?: string
  counts?: { AUTO_REPLY: number; BOT_FLOW: number }
}) {
  return (
    <nav
      aria-label="Automation tools"
      className="flex min-w-0 gap-4 overflow-x-auto border-b border-border"
    >
      {[
        { id: 'AUTO_REPLY', label: 'Auto Replies', href: '/automations/reply-studio/auto-replies' },
        { id: 'BOT_FLOW', label: 'Bot Flows', href: '/automations/reply-studio/bot-flows' },
      ].map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={active === t.id ? 'page' : undefined}
          aria-label={t.label}
          aria-description={
            counts ? `${counts[t.id as keyof typeof counts]} saved items` : undefined
          }
          className={cn(
            'shrink-0 border-b-2 px-2 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-focus-ring',
            active === t.id
              ? 'border-primary text-slate'
              : 'border-transparent text-secondary hover:text-slate',
          )}
        >
          {t.label}
          {counts ? (
            <span className="ml-2 rounded-md bg-neutral-soft px-2 py-0.5 text-xs text-secondary">
              {counts[t.id as keyof typeof counts]}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}
