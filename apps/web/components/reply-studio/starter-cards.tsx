'use client'
import { REPLY_PRESETS, type ReplyPresetId } from '@fenwira/contracts'
import { Button, cn } from '@fenwira/ui'
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Clock3,
  GitBranch,
  Handshake,
  MapPin,
  MessageCircle,
  MessagesSquare,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { useSession } from '@/components/session/session-provider'

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
      className={cn(
        'flex h-32 flex-col justify-center gap-2 overflow-hidden rounded-lg bg-neutral-soft p-4',
        className,
      )}
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
export function ReplyStarterCards({
  kind,
  populated = false,
}: {
  kind: 'AUTO_REPLY' | 'BOT_FLOW'
  populated?: boolean
}) {
  const { me, tenantId } = useSession()
  const key = `fenwira.reply-starters.${me.user.id}.${tenantId}.${kind}`
  const [expanded, setExpanded] = useState(false)
  const region = useId()
  useEffect(() => {
    try {
      setExpanded(localStorage.getItem(key) === 'open')
    } catch {
      /* Optional preference. */
    }
  }, [key])
  const show = !populated || expanded
  return (
    <section aria-label="Starter flows" className="flex flex-col gap-4">
      <div className={populated ? 'flex flex-wrap items-center justify-between gap-2' : undefined}>
        {populated ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-md font-semibold text-slate">
                {kind === 'AUTO_REPLY'
                  ? 'Start with a ready-made reply'
                  : 'Start with a guided conversation'}
              </h2>
              <p className="mt-1 text-xs text-muted">
                Editable starters. Customise, test, then publish.
              </p>
            </div>
          </div>
        ) : null}
        {populated ? (
          <Button
            variant="ghost"
            className="justify-start self-start"
            aria-expanded={expanded}
            aria-controls={region}
            onClick={() => {
              setExpanded(!expanded)
              try {
                localStorage.setItem(key, !expanded ? 'open' : 'closed')
              } catch {
                /* Optional preference. */
              }
            }}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            Starter conversations
          </Button>
        ) : (
          <div>
            <h2 className="text-lg font-semibold text-slate">
              {kind === 'AUTO_REPLY'
                ? 'Create your first auto reply'
                : 'Create your first bot flow'}
            </h2>
            <p className="mt-2 text-sm text-secondary">
              Start with an editable conversation recipe. Nothing runs until you publish.
            </p>
          </div>
        )}
      </div>
      {populated && !expanded ? (
        <div className="grid gap-3 md:grid-cols-3">
          {REPLY_PRESETS.filter((p) => p.kind === kind).map((p) => {
            const Icon = PRESET_ICON[p.id]
            return (
              <article
                key={p.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <h3 className="text-sm font-semibold text-slate">{p.title}</h3>
                  <p className="text-xs text-muted">{p.help}</p>
                  <Link
                    href={`/automations/reply-studio/new?kind=${kind}&preset=${p.id}`}
                    aria-label={`Use starter: ${p.title}`}
                    className="inline-flex min-h-6 items-center rounded-sm text-xs font-semibold text-primary-strong focus-visible:outline-2 focus-visible:outline-primary-strong"
                  >
                    Use starter →
                  </Link>
                </div>
              </article>
            )
          })}
        </div>
      ) : null}
      <div
        id={region}
        hidden={!show}
        className={cn(
          show ? 'grid gap-4 md:grid-cols-2' : 'hidden',
          kind === 'AUTO_REPLY' && 'xl:grid-cols-3',
        )}
      >
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
              <p className="text-xs text-muted">
                {
                  {
                    welcome: 'New conversation · Contact cooldown',
                    'out-of-hours': 'Workspace hours · Holidays',
                    keyword: 'Keywords · Matching rules',
                    faq: 'Options · Team handover',
                    'product-enquiry': 'Questions · Review · Handover',
                  }[p.id]
                }
              </p>
              <Button asChild variant="secondary" className="w-full justify-between">
                <Link
                  aria-label={`Use starter: ${p.title}`}
                  href={`/automations/reply-studio/new?kind=${kind}&preset=${p.id}`}
                >
                  Use starter
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
