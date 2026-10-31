'use client'

import { type RoleMatrix } from '@fenwira/contracts'
import {
  ErrorState,
  PermissionState,
  SettingsPage,
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

  if (!can('roles.read')) return <PermissionState what="roles" />
  if (matrix.isError) return <ErrorState onRetry={() => void matrix.refetch()} />

  const areas = new Map<string, RoleMatrix['permissions']>()
  for (const permission of matrix.data?.permissions ?? []) {
    const area = permission.key.split('.')[0]!
    areas.set(area, [...(areas.get(area) ?? []), permission])
  }

  return (
    <SettingsPage
      header={{
        title: 'Roles',
        description: 'What each role can do. Roles are fixed; assign them on the Team page.',
      }}
    >
      {matrix.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Table aria-label="Role permissions" containerLabel="Role permissions">
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
                <TableRow className="bg-canvas hover:bg-surface-muted">
                  <TableCell
                    colSpan={matrix.data.roles.length + 1}
                    className="py-2 text-sm font-semibold text-fg"
                  >
                    {AREA_LABELS[area] ?? area}
                  </TableCell>
                </TableRow>
                {permissions.map((permission) => (
                  <TableRow key={permission.key}>
                    <TableCell>
                      <span className="block text-fg">{permission.description}</span>
                      <span className="font-mono text-xs text-fg-muted">{permission.key}</span>
                    </TableCell>
                    {matrix.data.roles.map((role) => (
                      <TableCell key={role.key} className="text-center">
                        {role.permissions.includes(permission.key) ? (
                          <Check
                            className="mx-auto size-4 text-fg"
                            aria-label={`${role.label}: allowed`}
                          />
                        ) : (
                          <Minus
                            className="mx-auto size-4 text-fg-subtle"
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
    </SettingsPage>
  )
}
