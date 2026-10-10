'use client'
import {
  Button,
  DetailDrawer,
  ErrorState,
  ListPage,
  Skeleton,
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
          'Latest 100 immutable security and commercial events. Financial details remain on workspace receipts.',
      }}
    >
      {result.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : result.isError ? (
        <ErrorState onRetry={() => void result.refetch()} />
      ) : (
        <Table containerLabel="Commercial records">
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                <TableCell>{r.action}</TableCell>
                <TableCell>{r.outcome}</TableCell>
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
                  <dt className="text-sm text-secondary">{key}</dt>
                  <dd className="break-all font-mono text-sm">
                    {typeof value === 'object' && value !== null
                      ? JSON.stringify(value)
                      : (value ?? '—')}
                  </dd>
                </div>
              ))
            : null}
        </dl>
      </DetailDrawer>
    </ListPage>
  )
}
