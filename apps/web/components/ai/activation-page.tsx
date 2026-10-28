'use client'

import { type AiActivationRequest, type AiPlan } from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  ErrorState,
  Skeleton,
  StatusBadge,
  toast,
} from '@fenwira/ui'
import {
  Activity,
  BarChart3,
  Check,
  ChevronDown,
  Clock,
  FileText,
  FlaskConical,
  Lock,
  MessagesSquare,
  Power,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { useAiActivation, useCancelAiActivation } from '@/lib/ai'
import { ActivationRequestDialog } from './activation-request-dialog'

export function formatPlanPrice(plan: Pick<AiPlan, 'monthlyPriceMinor' | 'currency'>) {
  const format = new Intl.NumberFormat('en-IN', { style: 'currency', currency: plan.currency })
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2
  return `${format.format(plan.monthlyPriceMinor / 10 ** digits)} / month`
}

const BENEFITS = [
  {
    icon: Clock,
    title: 'Answers 24/7 from your documents',
    body: 'Customers get replies at night and on weekends, using only what you upload.',
  },
  {
    icon: MessagesSquare,
    title: 'Fewer repetitive chats',
    body: 'Prices, hours and delivery questions are answered before they reach your team.',
  },
  {
    icon: Users,
    title: 'Instant handoff to your team',
    body: 'When the assistant is unsure, the conversation goes straight to an agent in the Inbox.',
  },
  {
    icon: FlaskConical,
    title: 'Full control',
    body: 'Test answers privately and choose when it goes live. Turn it off at any time.',
  },
  {
    icon: BarChart3,
    title: 'Usage you can see',
    body: 'A dashboard shows replies used this month, handoffs and recent activity.',
  },
  {
    icon: Lock,
    title: 'Your data stays private',
    body: 'Documents and conversations are kept to your workspace and never shared with others.',
  },
] as const

const STEPS = [
  { title: 'Upload documents', body: 'Add PDFs, Word files, notes or FAQs about your business.' },
  { title: 'Test answers', body: 'Ask sample questions and see the exact sources used.' },
  { title: 'Turn it on', body: 'Switch it on for WhatsApp when the answers look right.' },
  { title: 'Agents take over when needed', body: 'Unclear questions are handed to your team.' },
] as const

const FEATURES = [
  'PDF, DOCX, TXT, MD and CSV documents, plus FAQs',
  'Source snippets shown with every test answer',
  'Tone, fallback and handoff message settings',
  'Usage dashboard with the monthly reply allowance',
  'Activity log of every AI reply and handoff',
  'English replies (more languages later)',
] as const

const LIMITS = [
  'It answers only from the documents you add.',
  'It hands the conversation to your team when it is unsure.',
  'It does not guarantee every answer is accurate: review the Activity log.',
  'It replies only inside WhatsApp’s 24-hour customer service window.',
] as const

const FAQ = [
  {
    q: 'Which customers will the assistant reply to?',
    a: 'Customers who message your WhatsApp number while the assistant is on. You choose when to turn it on after testing.',
  },
  {
    q: 'What happens when the monthly AI replies run out?',
    a: 'The assistant stops replying and hands every new conversation to your team. Nothing is charged automatically.',
  },
  {
    q: 'Can the assistant make things up?',
    a: 'It is instructed to answer only from your documents and to hand over when it cannot find an answer. Like any AI, it can still make mistakes, so check the Activity log.',
  },
  {
    q: 'How long does activation take?',
    a: 'The Fenwira team reviews requests on working days and confirms by email and in Fenwira.',
  },
] as const

const STATUS: Record<
  AiActivationRequest['status'],
  { status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; label: string }
> = {
  REQUESTED: { status: 'PENDING', label: 'Requested' },
  APPROVED: { status: 'APPROVED', label: 'Approved' },
  REJECTED: { status: 'REJECTED', label: 'Rejected' },
  CANCELLED: { status: 'CANCELLED', label: 'Cancelled' },
}

/**
 * AI Assistant while it is off for the workspace: what you get, pricing from the operator's
 * plans, and the activation request (docs/AI_ASSISTANT.md → Activation requests).
 */
export function ActivationPage() {
  const { can } = useSession()
  const state = useAiActivation()
  const [dialog, setDialog] = useState<{ planId?: string } | null>(null)
  const canRequest = can('ai.manage')
  if (state.isLoading) return <Skeleton className="h-96" />
  if (state.isError || !state.data) return <ErrorState onRetry={() => state.refetch()} />
  const data = state.data
  const open = data.request?.status === 'REQUESTED'
  const requestAction = (planId?: string) =>
    canRequest ? (
      <Button onClick={() => setDialog({ planId })} disabled={open}>
        Request activation
      </Button>
    ) : null

  return (
    <div className="flex flex-col gap-10">
      <section
        aria-labelledby="ai-hero"
        className="rounded-lg border border-border bg-surface p-6 md:p-8"
      >
        <div className="flex max-w-2xl flex-col gap-4">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary-strong">
            <Sparkles aria-hidden="true" className="size-5" />
          </span>
          <h2 id="ai-hero" className="text-2xl font-semibold text-slate">
            Answer WhatsApp customers instantly, from your own documents
          </h2>
          <p className="text-md text-secondary">
            The AI Assistant replies around the clock using only what you upload, and hands the
            conversation to your team whenever it is unsure.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {canRequest ? (
              requestAction()
            ) : (
              <p className="text-sm text-secondary">
                Ask your workspace admin to request activation.
              </p>
            )}
            <Button variant="secondary" asChild>
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>
        </div>
        {data.request ? (
          <RequestStatus
            request={data.request}
            canManage={canRequest}
            onRequestAgain={() => setDialog({})}
          />
        ) : null}
      </section>

      <section aria-labelledby="ai-benefits" className="flex flex-col gap-4">
        <h2 id="ai-benefits" className="text-xl font-semibold text-slate">
          What you get
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5"
            >
              <Icon aria-hidden="true" className="size-5 text-primary-strong" />
              <h3 className="text-md font-semibold text-slate">{title}</h3>
              <p className="text-base text-secondary">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        id="how-it-works"
        aria-labelledby="ai-how"
        className="flex scroll-mt-20 flex-col gap-4"
      >
        <h2 id="ai-how" className="text-xl font-semibold text-slate">
          How it works
        </h2>
        <ol className="grid gap-4 md:grid-cols-4">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5"
            >
              <span
                aria-hidden="true"
                className="flex size-7 items-center justify-center rounded-full bg-primary-strong text-sm font-semibold text-surface"
              >
                {index + 1}
              </span>
              <h3 className="text-md font-semibold text-slate">{step.title}</h3>
              <p className="text-base text-secondary">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="ai-features" className="flex flex-col gap-4">
          <h2 id="ai-features" className="text-xl font-semibold text-slate">
            Features
          </h2>
          <ul className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex gap-3 text-base text-slate">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary-strong" />
                {feature}
              </li>
            ))}
          </ul>
        </section>
        <TestPreview />
      </div>

      <section aria-labelledby="ai-pricing" className="flex flex-col gap-4">
        <h2 id="ai-pricing" className="text-xl font-semibold text-slate">
          Pricing
        </h2>
        {data.plans.length ? (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.plans.map((plan) => (
              <li key={plan.id}>
                <Card className="flex h-full flex-col">
                  <CardHeader>
                    <CardTitle as="h3">{plan.name}</CardTitle>
                    {plan.description ? (
                      <CardDescription>{plan.description}</CardDescription>
                    ) : null}
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    <p className="text-2xl font-semibold text-slate">{formatPlanPrice(plan)}</p>
                    <p className="text-base text-slate">
                      {plan.includedReplies.toLocaleString('en-IN')} AI replies per month
                    </p>
                    <p className="text-sm text-secondary">
                      After the allowance runs out, conversations go to your team until the next
                      month.
                    </p>
                    <div className="mt-auto pt-2">{requestAction(plan.id)}</div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle as="h3">Contact us for pricing</CardTitle>
              <CardDescription>
                Send a request and the Fenwira team will share a plan that fits your volume.
              </CardDescription>
            </CardHeader>
            <CardContent>{requestAction()}</CardContent>
          </Card>
        )}
      </section>

      <Alert tone="info" title="Good to know">
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          {LIMITS.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </Alert>

      <section aria-labelledby="ai-faq" className="flex flex-col gap-4">
        <h2 id="ai-faq" className="text-xl font-semibold text-slate">
          Questions
        </h2>
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {FAQ.map((item) => (
            <details key={item.q} className="group">
              <summary className="fw-summary flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-base font-medium text-slate focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-strong">
                {item.q}
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-secondary transition-transform group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <p className="px-4 pb-4 text-base text-secondary">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {dialog ? (
        <ActivationRequestDialog
          open
          onOpenChange={(next) => !next && setDialog(null)}
          state={data}
          initialPlanId={dialog.planId}
        />
      ) : null}
    </div>
  )
}

function RequestStatus({
  request,
  canManage,
  onRequestAgain,
}: {
  request: AiActivationRequest
  canManage: boolean
  onRequestAgain: () => void
}) {
  const cancel = useCancelAiActivation()
  const [confirm, setConfirm] = useState(false)
  if (request.status === 'CANCELLED') return null
  const badge = STATUS[request.status]
  return (
    <div
      role="status"
      aria-label="Activation request"
      className="mt-6 flex flex-col gap-3 rounded-lg border border-border bg-neutral-soft p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-md font-semibold text-slate">
          {request.status === 'REQUESTED' ? 'Request received' : 'Activation request'}
        </h3>
        <StatusBadge status={badge.status} label={badge.label} />
      </div>
      <p className="text-base text-slate">
        {request.status === 'REQUESTED'
          ? 'The Fenwira team is reviewing your request. You’ll get an email and a notification here when it’s decided.'
          : request.status === 'APPROVED'
            ? 'Approved. The assistant is being turned on for your workspace.'
            : 'The Fenwira team could not turn it on yet.'}
      </p>
      <dl className="grid max-w-md grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <dt className="text-secondary">Plan</dt>
        <dd className="text-slate">{request.planName ?? 'Pricing requested'}</dd>
        <dt className="text-secondary">Sent</dt>
        <dd className="text-slate">
          {new Date(request.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
        </dd>
        {request.decisionNote ? (
          <>
            <dt className="text-secondary">{request.status === 'REJECTED' ? 'Reason' : 'Note'}</dt>
            <dd className="text-slate">{request.decisionNote}</dd>
          </>
        ) : null}
      </dl>
      {canManage && request.status === 'REQUESTED' ? (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
            Cancel request
          </Button>
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title="Cancel this request?"
            description="The Fenwira team will no longer review it. You can send a new request later."
            confirmLabel="Cancel request"
            cancelLabel="Keep request"
            onConfirm={() =>
              cancel.mutate(request.id, {
                onSuccess: () => {
                  setConfirm(false)
                  toast.success('Request cancelled')
                },
              })
            }
          />
        </div>
      ) : null}
      {canManage && request.status === 'REJECTED' ? (
        <div>
          <Button size="sm" onClick={onRequestAgain}>
            Request again
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** Static example of the Test tab: no model call, no network. */
function TestPreview() {
  return (
    <section aria-labelledby="ai-preview" className="flex flex-col gap-4">
      <h2 id="ai-preview" className="text-xl font-semibold text-slate">
        Test before going live
      </h2>
      <figure
        aria-label="Example test conversation"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-soft text-secondary"
          >
            <UserRound className="size-4" />
          </span>
          <p className="rounded-lg bg-neutral-soft px-3 py-2 text-base text-slate">
            Are you open on Saturday?
          </p>
        </div>
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong"
          >
            <Sparkles className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-2">
            <p className="rounded-lg bg-message-outbound px-3 py-2 text-base text-slate">
              Yes, we’re open on Saturday from 10am to 2pm.
            </p>
            <div className="flex flex-col gap-1 rounded-md border border-border p-3">
              <p className="flex items-center gap-2 text-xs font-medium text-secondary">
                <FileText aria-hidden="true" className="size-3.5" />
                Source: Opening hours.pdf
              </p>
              <p className="text-sm text-slate">
                “…On Saturday the opening hours are 10am to 2pm.”
              </p>
            </div>
          </div>
        </div>
        <figcaption className="flex items-center gap-2 text-xs text-secondary">
          <Activity aria-hidden="true" className="size-3.5" />
          Example only. Your own test answers come from your documents.
        </figcaption>
      </figure>
      <p className="flex items-center gap-2 text-sm text-secondary">
        <Power aria-hidden="true" className="size-4" />
        Nothing reaches customers until you turn it on.
      </p>
    </section>
  )
}
