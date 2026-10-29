import { Button, cn } from '@fenwira/ui'
import Link from 'next/link'
export function AutomationNavigation({ studio = false }: { studio?: boolean }) {
  return (
    <nav
      aria-label="Automation tools"
      className="flex w-fit max-w-full gap-2 overflow-x-auto rounded-lg border border-border bg-neutral-soft p-1"
    >
      {[
        { label: 'All automations', href: '/automations', active: !studio },
        { label: 'Reply Studio', href: '/automations/reply-studio', active: studio },
      ].map((t) => (
        <Button
          key={t.href}
          asChild
          variant="ghost"
          size="sm"
          className={cn(
            'shrink-0 px-4',
            t.active ? 'bg-surface text-slate shadow-raised' : 'text-secondary',
          )}
        >
          <Link href={t.href} aria-current={t.active ? 'page' : undefined}>
            {t.label}
          </Link>
        </Button>
      ))}
    </nav>
  )
}
