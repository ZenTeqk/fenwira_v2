'use client'

import { type RoleMatrix } from '@fenwira/contracts'
import {
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import { Check, Minus } from 'lucide-react'
import { Fragment } from 'react'
import { useSession } from '@/components/session/session-provider'
import { NoAccess } from '@/components/settings/no-access'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

const AREA_LABELS: Record<string, string> = {
  workspace: 'Workspace',
  team: 'Team',
  roles: 'Roles',
  whatsapp: 'WhatsApp',
  contacts: 'Contacts',
  inbox: 'Inbox',
  templates: 'Templates',
  campaigns: 'Campaigns',
  automations: 'Automations',
  analytics: 'Analytics',
  billing: 'Billing',
  integrations: 'Integrations',
  audit: 'Audit',
}

/** Read-only role × permission matrix. Roles are fixed in v2 (docs/SECURITY.md → RBAC). */
export default function RolesPage() {
  const { tenantId, can } = useSession()
  const matrix = useQuery({
    queryKey: keys.tenant(tenantId, 'roles'),
    queryFn: () => get<{ data: RoleMatrix }>('/roles').then((r) => r.data),
    enabled: can('roles.read'),
    staleTime: Infinity,
  })

  if (!can('roles.read')) return <NoAccess what="roles" />
  if (matrix.isError) return <ErrorState onRetry={() => void matrix.refetch()} />

  const areas = new Map<string, RoleMatrix['permissions']>()
  for (const permission of matrix.data?.permissions ?? []) {
    const area = permission.key.split('.')[0]!
    areas.set(area, [...(areas.get(area) ?? []), permission])
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Roles"
        description="What each role can do. Roles are fixed; assign them on the Team page."
      />
      {matrix.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Table aria-label="Role permissions">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col">Permission</TableHead>
              {matrix.data.roles.map((role) => (
                <TableHead key={role.key} scope="col" className="text-center">
                  {role.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...areas.entries()].map(([area, permissions]) => (
              <Fragment key={area}>
                <TableRow className="bg-background hover:bg-background">
                  <TableCell
                    colSpan={matrix.data.roles.length + 1}
                    className="py-2 text-sm font-semibold text-slate"
                  >
                    {AREA_LABELS[area] ?? area}
                  </TableCell>
                </TableRow>
                {permissions.map((permission) => (
                  <TableRow key={permission.key}>
                    <TableCell>
                      <span className="block text-slate">{permission.description}</span>
                      <span className="font-mono text-xs text-muted">{permission.key}</span>
                    </TableCell>
                    {matrix.data.roles.map((role) => (
                      <TableCell key={role.key} className="text-center">
                        {role.permissions.includes(permission.key) ? (
                          <Check
                            className="mx-auto size-4 text-primary-strong"
                            aria-label={`${role.label}: allowed`}
                          />
                        ) : (
                          <Minus
                            className="mx-auto size-4 text-slate-400"
                            aria-label={`${role.label}: not allowed`}
                          />
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
