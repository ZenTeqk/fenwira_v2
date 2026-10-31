'use client'
import {
  platformInvoiceSchema,
  platformMemberSchema,
  platformWhatsAppConnectionSchema,
  type PlatformWorkspace,
} from '@fenwira/contracts'
import { Card, CardContent, CardHeader, CardTitle } from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Circle } from 'lucide-react'
import { z } from 'zod'
import { platformRequest } from '@/lib/platform'
import { usePlatform } from './platform-shell'

/** Same keys and parsers as the Team, WhatsApp and Invoices cards, so the data is fetched once. */
export function useWorkspaceParts(id: string) {
  const me = usePlatform()
  const members = useQuery({
    queryKey: ['platform', 'members', id],
    retry: false,
    queryFn: async () =>
      z.array(platformMemberSchema).parse(await platformRequest(`/workspaces/${id}/members`)),
  })
  const connections = useQuery({
    queryKey: ['platform', 'whatsapp', id],
    enabled: me?.permissions.includes('whatsapp.read') ?? false,
    retry: false,
    queryFn: async () =>
      z
        .array(platformWhatsAppConnectionSchema)
        .parse(await platformRequest(`/workspaces/${id}/whatsapp/connections`)),
  })
  const invoices = useQuery({
    queryKey: ['platform', 'invoices', id],
    enabled: me?.permissions.includes('payments.read') ?? false,
    retry: false,
    queryFn: async () =>
      z.array(platformInvoiceSchema).parse(await platformRequest(`/workspaces/${id}/invoices`)),
  })
  return { members, connections, invoices }
}

/** What is left to do for this workspace, in onboarding order (docs/MANAGED_LAUNCH.md § 3). */
export function WorkspaceNextSteps({ data }: { data: PlatformWorkspace }) {
  const { workspace, subscription } = data.snapshot
  const { members, connections, invoices } = useWorkspaceParts(workspace.id)
  const owner = members.data?.find((m) => m.role === 'OWNER')
  const connected = connections.data?.some((c) => c.status === 'CONNECTED') ?? false
  const paid =
    subscription?.status === 'ACTIVE' || (invoices.data?.some((i) => i.status === 'PAID') ?? false)
  const steps: Array<{ done: boolean; title: string; hint: string }> = [
    {
      done: owner?.emailVerified ?? false,
      title: 'Owner has set up their account',
      hint: 'Send the owner their setup link from the Team card (Reset link), then they set a password.',
    },
    {
      done: connected,
      title: 'WhatsApp number connected and verified',
      hint: 'Use Connect WhatsApp number below, then Verify connection.',
    },
    ...(workspace.isInternal
      ? []
      : [
          {
            done: !!(subscription?.planId ?? subscription?.requestedPlanId),
            title: 'Plan chosen',
            hint: 'Agree the plan with the customer; the invoice you create sets it.',
          },
          {
            done: (invoices.data?.length ?? 0) > 0,
            title: 'Invoice sent',
            hint: 'Create invoice below, then copy the payment link or message to the customer.',
          },
          {
            done: paid,
            title: 'Payment received and approved',
            hint: 'When the customer submits the UTR, approve it in Billing operations.',
          },
        ]),
  ]
  const left = steps.filter((s) => !s.done).length
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Next steps</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-fg-secondary">
          {workspace.isInternal
            ? 'Internal workspace: Business limits, no billing steps.'
            : left === 0
              ? 'All set: this workspace is onboarded and paid.'
              : `${left} of ${steps.length} steps left.`}
        </p>
        <ol className="flex flex-col gap-3" aria-label="Next steps">
          {steps.map((s) => (
            <li key={s.title} className="flex gap-3">
              {s.done ? (
                <CheckCircle2
                  className="mt-0.5 size-5 shrink-0 text-status-success-fg"
                  aria-hidden
                />
              ) : (
                <Circle className="mt-0.5 size-5 shrink-0 text-fg-secondary" aria-hidden />
              )}
              <div>
                <p className="font-medium">
                  {s.title}
                  <span className="sr-only">{s.done ? ' (done)' : ' (to do)'}</span>
                </p>
                {s.done ? null : <p className="text-sm text-fg-secondary">{s.hint}</p>}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
