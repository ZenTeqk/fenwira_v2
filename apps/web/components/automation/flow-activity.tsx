'use client'
import { type Execution, type ReplyReport } from '@fenwira/contracts'
import {
  Button,
  Drawer,
  DrawerContent,
  ErrorState,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { automationKey } from '@/lib/automation'
export function FailureList({ failures }: { failures: ReplyReport['failures'] }) {
  return failures.length ? (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
      {failures.map((f, i) => (
        <li
          key={`${f.executionId}-${i}`}
          className="flex flex-wrap items-start justify-between gap-4 p-4"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <time dateTime={f.at} className="text-xs text-muted">
              {new Date(f.at).toLocaleString()}
            </time>
            <p className="text-sm text-slate">{friendlyFailure(f.code, f.reason)}</p>
            <code className="text-xs text-danger-strong">{f.code ?? 'SEND_FAILED'}</code>
            <details className="text-xs text-secondary">
              <summary>Technical details</summary>
              <p className="mt-2 break-words">{f.reason}</p>
            </details>
          </div>
          <div className="flex flex-wrap gap-2">
            {f.flowId ? (
              <Button asChild variant="secondary" size="sm">
                <Link
                  href={`/automations/${f.flowId}/edit?node=${encodeURIComponent(f.step)}&canvas=1`}
                >
                  Open step {f.step}
                </Link>
              </Button>
            ) : null}
            {f.conversationId ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/inbox?c=${f.conversationId}`}>Open conversation</Link>
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-secondary">No failures recorded.</p>
  )
}
function friendlyFailure(code: string | undefined, detail: string) {
  if (code === 'CONVERSATION_WINDOW_CLOSED')
    return 'The reply window closed. Use an approved WhatsApp template to contact this customer.'
  if (code === 'CONSENT_REQUIRED')
    return 'This message needs consent from the customer before it can be sent.'
  if (code === 'CONTACT_BLOCKED') return 'This customer is blocked, so the reply could not be sent.'
  if (code === 'AUTOMATION_BLOCKED_BY_TAKEOVER')
    return 'A teammate took over this conversation. The queued reply was cancelled.'
  if (code === 'FLOW_REFERENCE_MISSING')
    return 'A step refers to an item that is no longer available. Open the step to update it.'
  return detail && !/^[A-Z_]+$/.test(detail)
    ? detail
    : 'This step could not finish. Open its settings and conversation to check what needs attention.'
}
export function FlowActivity({ flowId }: { flowId: string }) {
  const [open, setOpen] = useState(false)
  const { tenantId } = useSession()
  const runs = useQuery({
    queryKey: automationKey(tenantId, 'recent-activity', flowId),
    queryFn: () =>
      get<{ data: Execution[] }>(`/flows/${flowId}/executions?limit=20`).then((r) => r.data),
    enabled: open,
  })
  const failures = useQuery({
    queryKey: automationKey(tenantId, 'recent-failures', flowId),
    queryFn: () =>
      get<{ data: ReplyReport }>(
        `/reply-studio/reports?${new URLSearchParams({ flowId, from: new Date(Date.now() - 30 * 86400000).toISOString(), to: new Date().toISOString() })}`,
      ).then((r) => r.data.failures),
    enabled: open,
  })
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Did this run?
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent
          title="Recent activity"
          description="The last 20 runs. Failures cover the last 30 days."
        >
          <Tabs defaultValue="runs">
            <TabsList>
              <TabsTrigger value="runs">Recent runs</TabsTrigger>
              <TabsTrigger value="failures">Failures</TabsTrigger>
            </TabsList>
            <TabsContent value="runs">
              {runs.isPending ? (
                <Skeleton className="h-20 w-full" />
              ) : runs.isError ? (
                <ErrorState onRetry={() => void runs.refetch()} />
              ) : !runs.data.length ? (
                <p className="text-sm text-secondary">No runs yet</p>
              ) : (
                <ol className="flex flex-col gap-4">
                  {runs.data.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-col gap-2 rounded-lg border border-border p-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge
                          status={r.errorCode === 'SESSION_EXPIRED' ? 'EXPIRED' : r.status}
                        />
                        <time dateTime={r.startedAt} className="text-xs text-muted">
                          {new Date(r.startedAt).toLocaleString()}
                        </time>
                      </div>
                      <p className="text-sm text-secondary">
                        {r.contactName ?? 'Customer'} · Published version {r.flowVersion}
                      </p>
                      {r.errorDetail ? (
                        <p className="text-sm text-secondary">
                          {friendlyFailure(r.errorCode ?? undefined, r.errorDetail)}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-4">
                        <Link
                          className="text-sm text-primary-strong underline"
                          href={`/automations/${flowId}/history?execution=${r.id}`}
                        >
                          Execution details
                        </Link>
                        {r.conversationId ? (
                          <Link
                            className="text-sm text-primary-strong underline"
                            href={`/inbox?c=${r.conversationId}`}
                          >
                            Open conversation
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </TabsContent>
            <TabsContent value="failures">
              {failures.isPending ? (
                <Skeleton className="h-20 w-full" />
              ) : failures.isError ? (
                <ErrorState onRetry={() => void failures.refetch()} />
              ) : (
                <FailureList failures={failures.data} />
              )}
            </TabsContent>
          </Tabs>
        </DrawerContent>
      </Drawer>
    </>
  )
}
