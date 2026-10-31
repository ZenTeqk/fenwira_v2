'use client'
import {
  Badge,
  Button,
  DetailDrawer,
  ErrorState,
  ListPage,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'
import { platformAuditSchema as auditSchema } from '@fenwira/contracts'
import { platformRequest } from '@/lib/platform'
import { usePlatform } from '@/components/platform/platform-shell'
/** Outcomes the API records; anything else is shown as-is in a neutral badge. */
function Outcome({ value }: { value: string }) {
  if (value === 'SUCCESS') return <StatusBadge status="SUCCEEDED" label="Success" />
  if (value === 'DENIED') return <StatusBadge status="REJECTED" label="Denied" />
  if (value === 'FAILED') return <StatusBadge status="FAILED" />
  return <Badge tone="neutral">{value}</Badge>
}

export default function Page() {
  const me = usePlatform(),
    [selected, select] = useState<z.infer<typeof auditSchema> | null>(null)
  const result = useQuery({
    queryKey: ['platform', 'audit'],
    enabled: me?.permissions.includes('audit.read') ?? false,
    retry: false,
    queryFn: async () => z.array(auditSchema).parse(await platformRequest('/audit')),
  })
  if (!me?.permissions.includes('audit.read'))
    return <ErrorState title="Access denied" description="Audit permission is required." />
  return (
    <ListPage
      header={{
        title: 'Platform audit',
        description:
          'Who did what in the console: the latest 100 immutable security and commercial events. Financial details remain on workspace receipts. See docs/runbooks/PLATFORM_OPERATIONS.md.',
      }}
    >
      {result.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : result.isError ? (
        <ErrorState onRetry={() => void result.refetch()} />
      ) : (
        <Table containerLabel="Platform audit events">
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">
                  {new Date(r.createdAt).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-sm">{r.action}</TableCell>
                <TableCell className="font-mono text-xs text-fg-secondary">
                  {r.workspaceId ?? 'Console'}
                </TableCell>
                <TableCell>
                  <Outcome value={r.outcome} />
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="secondary" onClick={() => select(r)}>
                    Inspect {r.action}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <DetailDrawer
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) select(null)
        }}
        title="Immutable audit event"
        description="Read-only security record."
      >
        <dl className="flex flex-col gap-4">
          {selected
            ? Object.entries(selected).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-sm text-fg-secondary">{key}</dt>
                  <dd className="font-mono text-sm break-all text-fg">
                    {typeof value === 'object' && value !== null ? (
                      <pre className="rounded-md border border-border-subtle bg-surface-muted p-3 text-xs whitespace-pre-wrap">
                        {JSON.stringify(value, null, 2)}
                      </pre>
                    ) : (
                      (value ?? '—')
                    )}
                  </dd>
                </div>
              ))
            : null}
        </dl>
      </DetailDrawer>
    </ListPage>
  )
}
