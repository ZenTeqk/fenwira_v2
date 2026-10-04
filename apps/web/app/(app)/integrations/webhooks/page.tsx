'use client'

import {
  type CreatedWebhookEndpoint,
  type WebhookEndpoint,
  type WebhookEventType,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListPage,
  Modal,
  ModalClose,
  ModalContent,
  PermissionState,
  Skeleton,
  StatusBadge,
  toast,
} from '@fenwira/ui'
import { Check, Copy, Plus, Webhook } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import {
  eventFamiliesLabel,
  eventLabel,
  useCreateWebhookEndpoint,
  useWebhookEndpoints,
  useWebhooksEntitled,
  WEBHOOK_EVENT_FAMILIES,
} from '@/lib/webhooks'
import { ApiError } from '@/lib/api/client'

type Step = 'url' | 'events' | 'security' | 'review'
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'url', label: 'Endpoint URL' },
  { id: 'events', label: 'Events' },
  { id: 'security', label: 'Security' },
  { id: 'review', label: 'Review' },
]

function StepIndicator({ current }: { current: Step }) {
  const i = STEPS.findIndex((s) => s.id === current)
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label="Create webhook endpoint steps">
      {STEPS.map((s, idx) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            aria-current={idx === i ? 'step' : undefined}
            className={
              idx === i
                ? 'font-semibold text-primary-strong'
                : idx < i
                  ? 'text-slate'
                  : 'text-muted'
            }
          >
            {s.label}
          </span>
          {idx < STEPS.length - 1 ? (
            <span aria-hidden="true" className="text-border">
              /
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

/** Endpoint URL → Events → Security → Review (docs/WEBHOOKS.md → Creating an endpoint). */
function CreateEndpointDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (created: CreatedWebhookEndpoint) => void
}) {
  const [step, setStep] = useState<Step>('url')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<Set<WebhookEventType>>(new Set())
  const create = useCreateWebhookEndpoint()

  const reset = () => {
    setStep('url')
    setName('')
    setUrl('')
    setEvents(new Set())
    create.reset()
  }

  const toggleFamily = (familyEvents: WebhookEventType[], checked: boolean) =>
    setEvents((prev) => {
      const next = new Set(prev)
      for (const e of familyEvents) {
        if (checked) next.add(e)
        else next.delete(e)
      }
      return next
    })

  const canNext =
    step === 'url' ? name.trim() && url.trim() : step === 'events' ? events.size > 0 : true

  const next = () => setStep(STEPS[STEPS.findIndex((s) => s.id === step) + 1]?.id ?? step)
  const back = () => setStep(STEPS[STEPS.findIndex((s) => s.id === step) - 1]?.id ?? step)

  const submit = () =>
    create.mutate(
      { name: name.trim(), url: url.trim(), events: [...events] },
      { onSuccess: (created) => onCreated(created) },
    )

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <ModalContent
        title="Add webhook endpoint"
        description={<StepIndicator current={step} />}
        className="max-w-xl"
        footer={
          <>
            {step === 'url' ? (
              <ModalClose asChild>
                <Button variant="secondary">Cancel</Button>
              </ModalClose>
            ) : (
              <Button variant="secondary" onClick={back}>
                Back
              </Button>
            )}
            {step === 'review' ? (
              <Button onClick={submit} loading={create.isPending}>
                Create endpoint
              </Button>
            ) : (
              <Button onClick={next} disabled={!canNext}>
                Continue
              </Button>
            )}
          </>
        }
      >
        <FormError error={create.error} />
        {step === 'url' ? (
          <div className="flex flex-col gap-4">
            <Field label="Name" hint="So your team can tell endpoints apart.">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Production CRM"
                autoFocus
              />
            </Field>
            <Field
              label="Endpoint URL"
              hint="Must be HTTPS and publicly reachable. Fenwira will POST signed event payloads here."
            >
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhooks/fenwira"
                type="url"
              />
            </Field>
          </div>
        ) : null}
        {step === 'events' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Choose exactly what this endpoint should receive. Fenwira only ever sends events from
              this approved list — never arbitrary internal activity.
            </p>
            {WEBHOOK_EVENT_FAMILIES.map((family) => {
              const allSelected = family.events.every((e) => events.has(e))
              return (
                <div key={family.label} className="rounded-md border border-border p-3">
                  <label className="mb-2 flex items-center gap-2.5 text-sm font-semibold text-slate">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(checked) => toggleFamily(family.events, Boolean(checked))}
                    />
                    {family.label}
                  </label>
                  <div className="flex flex-col gap-2 pl-6">
                    {family.events.map((e) => (
                      <label key={e} className="flex items-center gap-2.5 text-base text-slate">
                        <Checkbox
                          checked={events.has(e)}
                          onCheckedChange={(checked) =>
                            setEvents((prev) => {
                              const n = new Set(prev)
                              if (checked) n.add(e)
                              else n.delete(e)
                              return n
                            })
                          }
                        />
                        {eventLabel(e)}
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
        {step === 'security' ? (
          <div className="flex flex-col gap-3 text-base text-slate">
            <p>Every delivery to this endpoint is protected the same way:</p>
            <ul className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
              <li>• A unique signing secret, generated when you create this endpoint</li>
              <li>• Every payload is HMAC-signed and timestamped so your server can verify it</li>
              <li>
                • The destination is checked and re-checked against private/internal addresses
              </li>
              <li>• Only HTTPS endpoints are accepted in production</li>
            </ul>
            <p className="text-sm text-muted">
              The signing secret is shown once, right after you create this endpoint.
            </p>
          </div>
        ) : null}
        {step === 'review' ? (
          <dl className="flex flex-col gap-3 text-base">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Name</dt>
              <dd className="font-medium text-slate">{name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">URL</dt>
              <dd className="max-w-xs truncate font-mono text-sm text-slate">{url}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Events</dt>
              <dd className="font-medium text-slate">{events.size} selected</dd>
            </div>
          </dl>
        ) : null}
      </ModalContent>
    </Modal>
  )
}

function RevealWebhookSecretDialog({
  created,
  onClose,
}: {
  created: CreatedWebhookEndpoint | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  if (!created) return null
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.secret)
      setCopied(true)
      toast.success('Signing secret copied')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy — select and copy the secret manually.")
    }
  }
  return (
    <Modal open onOpenChange={(v) => !v && onClose()}>
      <ModalContent
        title="Webhook endpoint created"
        hideClose
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="flex flex-col gap-4">
          <p className="text-base font-medium text-danger-strong">
            Copy this signing secret now. Fenwira will not show it again.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background p-3">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-sm text-slate">
              {created.secret}
            </code>
            <Button type="button" variant="secondary" size="sm" onClick={copy}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy secret'}
            </Button>
          </div>
          <p className="text-sm text-muted">
            Use it to verify the <code className="font-mono">X-Fenwira-Signature</code> header on
            every delivery to &quot;{created.endpoint.name}&quot;. See docs/WEBHOOKS.md for a
            verification example.
          </p>
        </div>
      </ModalContent>
    </Modal>
  )
}

function EndpointCard({ endpoint }: { endpoint: WebhookEndpoint }) {
  const healthy = endpoint.status === 'ACTIVE' && endpoint.failureCount === 0
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${
                endpoint.status === 'DISABLED'
                  ? 'bg-danger-strong'
                  : healthy
                    ? 'bg-success-strong'
                    : 'bg-warning'
              }`}
            />
            <h3 className="font-semibold text-slate">{endpoint.name}</h3>
          </div>
          <code className="truncate font-mono text-sm text-muted">{endpoint.url}</code>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-sm text-muted">
            <span>{eventFamiliesLabel(endpoint.events)}</span>
            <span aria-hidden="true">·</span>
            <StatusBadge
              status={
                endpoint.status === 'DISABLED' ? 'DISABLED' : healthy ? 'HEALTHY' : 'ATTENTION'
              }
            />
          </div>
        </div>
        <Link href={`/integrations/webhooks/${endpoint.id}`}>
          <Button variant="secondary" size="sm">
            Manage
          </Button>
        </Link>
      </div>
    </Card>
  )
}

export default function WebhooksPage() {
  const { can } = useSession()
  const list = useWebhookEndpoints()
  const entitled = useWebhooksEntitled().data ?? true
  const [createOpen, setCreateOpen] = useState(false)
  const [created, setCreated] = useState<CreatedWebhookEndpoint | null>(null)

  if (!can('integrations.manage'))
    return <PermissionState what="webhooks" permission="integrations.manage" />

  return (
    <ListPage
      header={{
        title: 'Webhooks',
        description: 'Receive Fenwira events in your application.',
        actions: entitled ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            Add endpoint
          </Button>
        ) : null,
      }}
      banner={
        entitled ? null : (
          <Alert tone="warning" title="Webhooks aren’t included in your current plan">
            Your endpoints are kept, but no events are delivered until webhooks are available again.
            Events in the meantime aren’t queued for later.{' '}
            <Link href="/billing/subscription" className="font-medium underline underline-offset-4">
              View subscription
            </Link>
          </Alert>
        )
      }
    >
      {list.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : list.isError ? (
        <ErrorState
          onRetry={() => list.refetch()}
          correlationId={list.error instanceof ApiError ? list.error.correlationId : undefined}
        />
      ) : !list.data?.length ? (
        <EmptyState
          icon={<Webhook aria-hidden="true" />}
          title="No webhook endpoints yet"
          description="Webhooks let your application react the moment something happens in Fenwira — a message status changes, a contact is created, a campaign finishes — without polling the API."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" />
              Add webhook endpoint
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {list.data.map((e) => (
            <EndpointCard key={e.id} endpoint={e} />
          ))}
        </div>
      )}
      <CreateEndpointDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(c) => {
          setCreateOpen(false)
          setCreated(c)
        }}
      />
      <RevealWebhookSecretDialog created={created} onClose={() => setCreated(null)} />
    </ListPage>
  )
}
