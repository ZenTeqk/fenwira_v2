import { cn } from '@fenwira/ui'
import Link from 'next/link'
export function AutomationNavigation({ active = 'workflows' }: { active?: string }) {
  return (
    <nav
      aria-label="Automation tools"
      className="flex min-w-0 gap-4 overflow-x-auto border-b border-border"
    >
      {[
        { id: 'workflows', label: 'Workflows', href: '/automations/workflows' },
        { id: 'AUTO_REPLY', label: 'Auto Replies', href: '/automations/reply-studio/auto-replies' },
        { id: 'BOT_FLOW', label: 'Bot Flows', href: '/automations/reply-studio/bot-flows' },
        { id: 'reports', label: 'Reports', href: '/automations/reply-studio/reports' },
      ].map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={active === t.id ? 'page' : undefined}
          className={cn(
            'shrink-0 border-b-2 px-2 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary-strong',
            active === t.id
              ? 'border-primary text-slate'
              : 'border-transparent text-secondary hover:text-slate',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
