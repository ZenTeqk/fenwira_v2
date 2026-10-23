'use client'
import { ProvisionWorkspace } from './platform-accounts'
import { platformWorkspaceIdentitySchema } from '@fenwira/contracts'
import {
  Button,
  EmptyState,
  ErrorState,
  ListPage,
  SearchInput,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { z } from 'zod'
import { platformRequest } from '@/lib/platform'
export function WorkspaceSearch({ operations = false }: { operations?: boolean }) {
  const [q, setQ] = useState(''),
    [search, setSearch] = useState('')
  const result = useQuery({
    queryKey: ['platform', 'workspaces', search],
    enabled: search.length >= 2,
    retry: false,
    queryFn: async () =>
      z
        .array(platformWorkspaceIdentitySchema)
        .parse(await platformRequest(`/workspaces?q=${encodeURIComponent(search)}&limit=20`)),
  })
  return (
    <ListPage
      header={{
        title: operations ? 'Billing operations' : 'Workspaces',
        description:
          'Find a workspace by name, exact ID or slug. Only commercial state is available.',
        actions: operations ? undefined : <ProvisionWorkspace />,
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setSearch(q.trim())
        }}
        className="flex flex-wrap gap-2"
      >
        <SearchInput
          label="Find workspace"
          value={q}
          onValueChange={setQ}
          minLength={2}
          maxLength={120}
          required
        />
        <Button type="submit">Search</Button>
      </form>
      {result.isFetching ? (
        <Skeleton className="h-24 w-full" />
      ) : result.isError ? (
        <ErrorState onRetry={() => void result.refetch()} />
      ) : result.data?.length ? (
        <Table containerLabel="Commercial records">
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.map((w) => (
              <TableRow key={w.id}>
                <TableCell>
                  <span className="font-medium">{w.name}</span>
                  <p className="break-all font-mono text-xs text-secondary">{w.id}</p>
                </TableCell>
                <TableCell>{w.slug}</TableCell>
                <TableCell>{new Date(w.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/platform/workspaces/${w.id}${operations ? '#operations' : ''}`}>
                      Open {w.name}
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          title={search ? 'No matching workspaces' : 'Select a workspace'}
          description="Search to inspect subscriptions, entitlements, wallet and commercial activity."
        />
      )}
    </ListPage>
  )
}
