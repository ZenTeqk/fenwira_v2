import { Button } from '@fenwira/ui'
import { ArrowUpRight, GitBranch, LayoutTemplate, MessageCircle } from 'lucide-react'
import Link from 'next/link'
const STARTERS = [
  {
    title: 'Auto reply',
    description: 'One rule. The right answer, instantly.',
    icon: MessageCircle,
    href: '/automations/reply-studio/new?kind=AUTO_REPLY',
  },
  {
    title: 'Bot flow',
    description: 'Guide enquiries from hello to handover.',
    icon: GitBranch,
    href: '/automations/reply-studio/new?kind=BOT_FLOW',
  },
  {
    title: 'Starter workflows',
    description: 'Make a ready-made workflow your own.',
    icon: LayoutTemplate,
    href: '/automations/new',
  },
]
export function StartWith() {
  return (
    <section aria-labelledby="start-with" className="flex flex-col gap-4">
      <h2 id="start-with" className="text-sm font-medium text-fg-secondary">
        Start with
      </h2>
      <div className="grid gap-4 md:grid-cols-3">
        {STARTERS.map((s) => (
          <Button
            key={s.title}
            asChild
            variant="secondary"
            className="h-auto whitespace-normal rounded-lg border-border-subtle bg-surface p-4 text-left transition-shadow hover:border-border-control hover:bg-surface hover:shadow-raised"
          >
            <Link href={s.href} className="group flex items-start gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-automation-bg text-accent-automation-fg">
                <s.icon aria-hidden="true" className="size-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="text-md font-semibold text-fg">{s.title}</span>
                <span className="text-sm font-normal text-fg-secondary">{s.description}</span>
              </span>
              <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
            </Link>
          </Button>
        ))}
      </div>
    </section>
  )
}
