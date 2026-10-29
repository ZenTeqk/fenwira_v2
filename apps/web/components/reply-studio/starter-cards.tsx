'use client'
import { REPLY_PRESETS, type ReplyPresetId } from '@fenwira/contracts'
import { Button, cn } from '@fenwira/ui'
import {
  ArrowRight,
  Clock3,
  GitBranch,
  Handshake,
  MapPin,
  MessageCircle,
  MessagesSquare,
} from 'lucide-react'
import Link from 'next/link'

const SNIPPETS: Record<ReplyPresetId, [string, string]> = {
  welcome: ['Hi, I have a question', 'Welcome! How can we help?'],
  'out-of-hours': ['Are you open?', 'Thanks for writing. We’ll reply when we reopen.'],
  keyword: ['Where are you located?', 'Here’s our address and how to find us.'],
  faq: ['I’d like some help', 'Of course. What can we help you with?'],
  'product-enquiry': [
    'I’m interested in a product',
    'Happy to help. Which category interests you?',
  ],
  blank: ['A customer writes to you', 'Your conversation starts here.'],
}
export function MiniChat({
  preset = 'welcome',
  className,
}: {
  preset?: ReplyPresetId
  className?: string
}) {
  const [incoming, outgoing] = SNIPPETS[preset]
  return (
    <div
      aria-hidden="true"
      className={cn('flex flex-col gap-2 rounded-lg bg-neutral-soft p-4', className)}
    >
      <div className="max-w-full self-start rounded-lg rounded-tl-sm border border-border bg-surface px-4 py-2 text-xs text-secondary">
        {incoming}
      </div>
      <div className="max-w-full self-end rounded-lg rounded-tr-sm bg-primary-soft px-4 py-2 text-xs text-primary-strong">
        {outgoing}
      </div>
      {preset === 'faq' || preset === 'product-enquiry' ? (
        <div className="flex justify-end gap-2">
          <span className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-secondary">
            {preset === 'faq' ? 'Opening hours' : 'Clothing'}
          </span>
          <span className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-secondary">
            {preset === 'faq' ? 'Talk to our team' : 'Home'}
          </span>
        </div>
      ) : null}
    </div>
  )
}
export const PRESET_ICON = {
  welcome: MessageCircle,
  'out-of-hours': Clock3,
  keyword: MapPin,
  faq: MessagesSquare,
  'product-enquiry': Handshake,
  blank: GitBranch,
}
export function ReplyStarterCards({ kind }: { kind: 'AUTO_REPLY' | 'BOT_FLOW' }) {
  return (
    <section aria-label="Starter flows" className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate">
          {kind === 'AUTO_REPLY'
            ? 'Your first reply, ready in minutes'
            : 'Turn a conversation into an enquiry'}
        </h2>
        <p className="mt-2 text-sm text-secondary">
          Start with an editable conversation recipe. Nothing runs until you publish.
        </p>
      </div>
      <div className={cn('grid gap-4 md:grid-cols-2', kind === 'AUTO_REPLY' && 'xl:grid-cols-3')}>
        {REPLY_PRESETS.filter((p) => p.kind === kind).map((p) => {
          const Icon = PRESET_ICON[p.id]
          return (
            <article
              key={p.id}
              className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 transition-shadow hover:border-border-strong hover:shadow-raised"
            >
              <MiniChat preset={p.id} />
              <div className="flex items-center gap-2">
                <Icon aria-hidden="true" className="size-4 text-primary-strong" />
                <h3 className="text-md font-semibold text-slate">{p.title}</h3>
              </div>
              <p className="flex-1 text-sm text-secondary">{p.help}</p>
              <Button asChild variant="secondary" className="w-full justify-between">
                <Link
                  aria-label={`Use ${p.title}`}
                  href={`/automations/reply-studio/new?kind=${kind}&preset=${p.id}`}
                >
                  Use this
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </Button>
            </article>
          )
        })}
      </div>
    </section>
  )
}
