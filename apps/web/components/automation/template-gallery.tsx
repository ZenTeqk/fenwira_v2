'use client'

import {
  type DraftGraph,
  type Flow,
  FLOW_TEMPLATE_CATEGORIES,
  FLOW_TEMPLATES,
  type FlowTemplate,
  type FlowTemplateCategory,
  type FlowVersion,
  isCondition,
  isTrigger,
} from '@fenwira/contracts'
import {
  Badge,
  cn,
  SearchInput,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@fenwira/ui'
import { useMutation } from '@tanstack/react-query'
import { Lock, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Fragment, useState } from 'react'
import { ApiError, get, post, put } from '@/lib/api/client'
import { isNotEnabled, useAiOverview } from '@/lib/ai'
import { autoLayout, NODE_LABEL } from '@/lib/automation'
import { NodeSymbol } from './node-presentation'

type Node = DraftGraph['nodes'][number]
type Lane = Node | { fork: Node[] }

/** The template's main path for the card preview: `next` steps, ending at its first fork. */
function lane(g: DraftGraph): Lane[] {
  const by = new Map(g.nodes.map((n) => [n.id, n]))
  const after = (id: string, h: string) => {
    const e = g.edges.find((x) => x.source === id && x.sourceHandle === h)
    return e ? by.get(e.target) : undefined
  }
  const out: Lane[] = []
  let n = g.nodes.find((x) => isTrigger(x.type))
  while (n && out.length < 6) {
    if (isCondition(n.type) || n.type === 'action.ai_reply') {
      out.push(n)
      const branches = (n.type === 'action.ai_reply' ? ['replied', 'needs_human'] : ['yes', 'no'])
        .map((h) => after(n!.id, h))
        .filter((x): x is Node => !!x)
      if (branches.length) out.push({ fork: branches })
      break
    }
    out.push(n)
    n = after(n.id, 'next')
  }
  return out
}

/** A small static drawing of the flow: kind-coloured tiles joined by connector lines. */
function MiniFlow({ graph }: { graph: DraftGraph }) {
  const steps = lane(graph)
  const names = steps
    .map((s) =>
      'fork' in s ? s.fork.map((f) => NODE_LABEL[f.type]).join(' or ') : NODE_LABEL[s.type],
    )
    .join(', then ')
  return (
    <div className="flex min-h-14 items-center rounded-md border border-border bg-background px-3 py-2">
      <span className="sr-only">Steps: {names}</span>
      <div aria-hidden="true" className="flex items-center">
        {steps.map((s, i) => (
          <Fragment key={i}>
            {i > 0 ? <span className="h-px w-3 bg-slate-400" /> : null}
            {'fork' in s ? (
              <span className="flex flex-col gap-1 border-l border-slate-400 pl-1.5">
                {s.fork.map((f) => (
                  <NodeSymbol key={f.id} type={f.type} compact />
                ))}
              </span>
            ) : (
              <NodeSymbol type={s.type} compact />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

const REQUIREMENT_LABEL = {
  APPROVED_TEMPLATE: 'Needs approved WhatsApp template',
  AI_ASSISTANT: 'Needs AI Assistant',
} as const

/**
 * "Create automation": category tabs, search, and cards for each template with a mini preview and
 * what it needs. "Start from scratch" is always the first card. Choosing a card creates the flow
 * with the template's graph (auto-laid-out) and opens the builder's setup checklist.
 */
export function TemplateGallery() {
  const router = useRouter()
  const ai = useAiOverview()
  const aiOn = ai.data?.enabled === true
  const aiReason = ai.isPending
    ? 'Checking whether AI Assistant is on…'
    : isNotEnabled(ai.error) || ai.data?.enabled === false
      ? 'AI Assistant isn’t enabled for this workspace. Ask us to add it to your plan.'
      : 'AI Assistant could not be checked. Try again later.'
  const [tab, setTab] = useState<FlowTemplateCategory>('POPULAR')
  const [search, setSearch] = useState('')
  const create = useMutation({
    mutationFn: async (t: FlowTemplate | null) => {
      const flow = (
        await post<{ data: Flow }>('/flows', {
          name: t?.title ?? 'Untitled automation',
          ...(t ? { reentryPolicy: t.reentryPolicy } : {}),
        })
      ).data
      if (t) {
        const draft = (await get<{ data: FlowVersion }>(`/flows/${flow.id}/draft`)).data
        await put(
          `/flows/${flow.id}/draft`,
          { graph: autoLayout(t.graph()) },
          { headers: { 'If-Match': draft.etag } },
        )
      }
      return { flow, template: t }
    },
    onSuccess: ({ flow, template }) =>
      router.push(`/automations/${flow.id}/edit${template ? `?template=${template.id}` : ''}`),
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'Could not create the automation.'),
  })
  const q = search.trim().toLowerCase()
  const matches = (t: FlowTemplate) => !q || `${t.title} ${t.description}`.toLowerCase().includes(q)

  const card = (t: FlowTemplate | null) => {
    const locked = !!t?.requires.includes('AI_ASSISTANT') && !aiOn
    const busy = create.isPending && create.variables?.id === t?.id
    return (
      <li key={t?.id ?? 'scratch'}>
        <button
          type="button"
          aria-disabled={locked || create.isPending ? true : undefined}
          aria-describedby={locked ? `locked-${t!.id}` : undefined}
          data-testid={`template-${t?.id ?? 'scratch'}`}
          onClick={() => {
            if (!locked && !create.isPending) create.mutate(t)
          }}
          className={cn(
            'flex h-full w-full flex-col gap-3 rounded-lg border bg-surface p-4 text-left shadow-raised transition-colors',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong',
            locked
              ? 'cursor-not-allowed border-border bg-neutral-soft'
              : 'border-border hover:border-primary',
            busy && 'border-primary',
          )}
        >
          <span className="flex items-start gap-3">
            {t ? (
              <NodeSymbol type={t.icon} tone="brand" />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-strong"
              >
                <Plus className="size-5" />
              </span>
            )}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-base font-semibold text-slate">
                {t?.title ?? 'Start from scratch'}
                {busy ? <span className="sr-only"> (creating…)</span> : null}
              </span>
              <span className="text-sm text-secondary">
                {t?.description ?? 'Build your own on the canvas or with the keyboard outline.'}
              </span>
            </span>
          </span>
          {t ? <MiniFlow graph={t.graph()} /> : null}
          {t?.requires.length ? (
            <span className="flex flex-wrap gap-1.5">
              {t.requires.map((r) => (
                <Badge key={r} tone={r === 'AI_ASSISTANT' ? 'info' : 'neutral'}>
                  {REQUIREMENT_LABEL[r]}
                </Badge>
              ))}
            </span>
          ) : null}
          {locked ? (
            <span
              id={`locked-${t!.id}`}
              className="flex items-start gap-1.5 text-sm text-secondary"
            >
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {aiReason}
            </span>
          ) : null}
        </button>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as FlowTemplateCategory)}>
        <div className="flex flex-col gap-3 border-b border-border pb-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList
            aria-label="Starter workflow categories"
            className="w-auto overflow-x-auto border-b-0"
          >
            {FLOW_TEMPLATE_CATEGORIES.map((c) => (
              <TabsTrigger key={c.id} value={c.id}>
                {c.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <SearchInput label="Search starter workflows" value={search} onValueChange={setSearch} />
        </div>
        {FLOW_TEMPLATE_CATEGORIES.map((c) => {
          const list = FLOW_TEMPLATES.filter((t) => t.categories.includes(c.id) && matches(t))
          return (
            <TabsContent key={c.id} value={c.id} className="mt-4">
              <ul
                aria-label={`${c.label} starter workflows`}
                className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
              >
                {card(null)}
                {list.map(card)}
              </ul>
              {q && !list.length ? (
                <p className="mt-4 text-sm text-secondary">
                  No {c.label.toLowerCase()} starter workflows match “{search.trim()}”. Try another
                  category, or start from scratch.
                </p>
              ) : null}
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
