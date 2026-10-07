'use client'

import { type Contact, type Member } from '@fenwira/contracts'
import {
  Avatar,
  Button,
  Checkbox,
  cn,
  Dropdown,
  DropdownCheckboxItem,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  EmptyState,
  ErrorState,
  Label,
  Pagination,
  type PaginationProps,
  RowActions,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import { Columns3, Download, ExternalLink, Eye, UserRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { SOURCE_LABEL } from '@/lib/contacts'
import { relativeTime } from '@/lib/relative-time'
import { DirectoryEligibility } from './eligibility-summary'
import { TagBadges } from './tag-badges'

export const contactName = (c: Contact) => c.name ?? c.waProfileName ?? 'Unnamed contact'

/** Names are resolved only through the existing authorized team read. */
export function useContactOwners() {
  const { tenantId, can, me } = useSession()
  const q = useQuery({
    queryKey: keys.tenant(tenantId, 'team-members'),
    queryFn: () => get<{ data: Member[] }>('/team/members').then((r) => r.data),
    enabled: can('team.read'),
  })
  return (ownerId: string | null) =>
    ownerId
      ? ownerId === me.user.id
        ? me.user.name
        : (q.data?.find((m) => m.userId === ownerId)?.name ?? null)
      : null
}

export function ContactOwner({ ownerId }: { ownerId: string | null }) {
  const resolveOwner = useContactOwners()
  const name = resolveOwner(ownerId)
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-secondary">
      {name ? (
        <Avatar appearance="varied" name={name} size="sm" />
      ) : (
        <UserRound aria-hidden="true" className="size-4 shrink-0 text-muted" />
      )}
      <span className="truncate">{name ?? (ownerId ? 'Assigned teammate' : 'Unassigned')}</span>
    </span>
  )
}

const OPTIONAL = ['phone', 'tags', 'eligibility', 'lastInbound', 'assigned'] as const
const LABELS = {
  phone: 'Phone',
  tags: 'Tags',
  eligibility: 'WhatsApp',
  lastInbound: 'Last incoming',
  assigned: 'Assigned',
}
type OptionalColumn = (typeof OPTIONAL)[number]

/** Contacts-specific directory: one selection model for desktop rows and mobile cards. */
export function ContactDirectory({
  data,
  preview,
  onPreview,
  selected,
  onSelectionChange,
  selectable,
  toolbar,
  bulkActions,
  loading,
  error,
  empty,
  pagination,
  onExport,
  exporting,
}: {
  data: Contact[]
  preview: string | null
  onPreview: (id: string) => void
  selected: string[]
  onSelectionChange: (ids: string[]) => void
  selectable: boolean
  toolbar: (columns: ReactNode) => ReactNode
  bulkActions?: ReactNode
  loading: boolean
  error?: { message: string; onRetry: () => void }
  empty: { title: string; description: string; action?: ReactNode }
  pagination: PaginationProps
  onExport?: () => void
  exporting: boolean
}) {
  const router = useRouter()
  const [visible, setVisible] = useState<Record<OptionalColumn, boolean>>({
    phone: true,
    tags: true,
    eligibility: true,
    lastInbound: true,
    assigned: true,
  })
  const toggle = (id: string) =>
    onSelectionChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  const selectedHere = data.filter((c) => selected.includes(c.id)).length
  const choice = (c: Contact, mobile: boolean) =>
    selectable ? (
      <Label
        htmlFor={`contact-select-${mobile ? 'mobile' : 'desktop'}-${c.id}`}
        className="flex size-10 shrink-0 cursor-pointer items-center justify-center"
      >
        <Checkbox
          id={`contact-select-${mobile ? 'mobile' : 'desktop'}-${c.id}`}
          aria-label={`Select ${contactName(c)}`}
          checked={selected.includes(c.id)}
          onCheckedChange={() => toggle(c.id)}
        />
      </Label>
    ) : null
  const identity = (c: Contact, mobile = false) => (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar name={contactName(c)} appearance="varied" className="size-9 shrink-0" />
      <div className="min-w-0 flex-1">
        <Button
          variant="ghost"
          onClick={() => onPreview(c.id)}
          data-contact-preview={c.id}
          aria-label={mobile ? `${contactName(c)} ${c.phoneE164}` : contactName(c)}
          aria-current={preview === c.id ? 'true' : undefined}
          className={cn(
            'h-auto min-h-6 max-w-full justify-start px-0 py-0 text-sm font-semibold',
            mobile && 'min-h-10',
          )}
          title={contactName(c)}
        >
          <span className="flex min-w-0 flex-col items-start">
            <span className="truncate">{contactName(c)}</span>
            {mobile ? <span className="text-xs font-normal text-muted">{c.phoneE164}</span> : null}
          </span>
        </Button>
        {!mobile ? (
          <p className="truncate text-xs text-muted">{c.email ?? SOURCE_LABEL[c.source]}</p>
        ) : null}
      </div>
    </div>
  )
  const actions = (c: Contact) => (
    <span data-contact-actions={c.id}>
      <RowActions
        label={`Actions for ${contactName(c)}`}
        actions={[
          {
            label: 'Quick view',
            icon: <Eye aria-hidden="true" />,
            onSelect: () => onPreview(c.id),
          },
          {
            label: 'Open contact',
            icon: <ExternalLink aria-hidden="true" />,
            onSelect: () => router.push(`/contacts/${c.id}`),
          },
        ]}
      />
    </span>
  )
  const columnClass = (id: OptionalColumn) =>
    cn(
      !visible[id] && 'hidden',
      visible[id] && id === 'tags' && 'hidden xl:table-cell',
      visible[id] && id === 'assigned' && 'hidden xl:table-cell',
      visible[id] && id === 'lastInbound' && 'hidden lg:table-cell',
    )
  const state = error ? (
    <ErrorState description={error.message} onRetry={error.onRetry} />
  ) : loading ? (
    <div className="flex flex-col gap-3 p-4">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  ) : !data.length ? (
    <EmptyState {...empty} />
  ) : null
  const columnMenu = (
    <Dropdown modal={false}>
      <DropdownTrigger asChild>
        <Button variant="secondary" size="sm" className="min-h-10 sm:min-h-8">
          <Columns3 aria-hidden="true" />
          Columns
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end">
        <DropdownLabel>Show columns</DropdownLabel>
        {OPTIONAL.map((id) => (
          <DropdownCheckboxItem
            key={id}
            className={
              id === 'phone' ? 'hidden md:flex' : id === 'assigned' ? 'hidden xl:flex' : undefined
            }
            checked={visible[id]}
            onCheckedChange={(checked) => setVisible((v) => ({ ...v, [id]: checked === true }))}
            onSelect={(e) => e.preventDefault()}
          >
            {LABELS[id]}
          </DropdownCheckboxItem>
        ))}
        {onExport ? (
          <>
            <DropdownSeparator />
            <DropdownItem disabled={exporting} onSelect={onExport}>
              <Download aria-hidden="true" />
              Export filtered contacts
            </DropdownItem>
          </>
        ) : null}
      </DropdownContent>
    </Dropdown>
  )
  return (
    <section
      aria-label="Contact directory"
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-wrap items-start gap-2 border-b border-border p-3">
        <div className="min-w-0 flex-1">{toolbar(columnMenu)}</div>
      </div>
      {state ?? (
        <>
          <div className="hidden md:block [&_[data-slot=table-container]]:rounded-none [&_[data-slot=table-container]]:border-0">
            <Table aria-label="Contacts" containerLabel="Contacts scroll area" className="text-sm">
              <TableHeader className="bg-surface">
                <TableRow className="hover:bg-transparent">
                  {selectable ? (
                    <TableHead className="w-10 px-1">
                      <Label className="flex size-10 items-center justify-center">
                        <Checkbox
                          aria-label="Select all rows"
                          checked={
                            selectedHere === data.length
                              ? true
                              : selectedHere
                                ? 'indeterminate'
                                : false
                          }
                          onCheckedChange={(checked) =>
                            onSelectionChange(
                              checked
                                ? [...new Set([...selected, ...data.map((c) => c.id)])]
                                : selected.filter((id) => !data.some((c) => c.id === id)),
                            )
                          }
                        />
                      </Label>
                    </TableHead>
                  ) : null}
                  <TableHead className="px-2 text-xs">Contact</TableHead>
                  {OPTIONAL.map((id) => (
                    <TableHead key={id} className={cn('px-2 text-xs', columnClass(id))}>
                      {LABELS[id]}
                    </TableHead>
                  ))}
                  <TableHead className="w-10 px-1">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((c) => (
                  <TableRow
                    key={c.id}
                    data-contact-row={c.id}
                    data-state={
                      selected.includes(c.id) || preview === c.id ? 'selected' : undefined
                    }
                  >
                    {selectable ? (
                      <TableCell className="w-10 px-1 py-2">{choice(c, false)}</TableCell>
                    ) : null}
                    <TableCell className="min-w-36 max-w-48 px-2 py-2">{identity(c)}</TableCell>
                    <TableCell
                      className={cn(
                        'whitespace-nowrap px-2 py-2 text-xs text-secondary',
                        columnClass('phone'),
                      )}
                    >
                      {c.phoneE164}
                    </TableCell>
                    <TableCell className={cn('max-w-28 px-2 py-2', columnClass('tags'))}>
                      <TagBadges tags={c.tags} max={1} />
                    </TableCell>
                    <TableCell className={cn('px-2 py-2', columnClass('eligibility'))}>
                      <DirectoryEligibility contactId={c.id} />
                    </TableCell>
                    <TableCell
                      className={cn('px-2 py-2 text-xs text-muted', columnClass('lastInbound'))}
                    >
                      {c.lastInboundAt ? (
                        <time dateTime={c.lastInboundAt}>{relativeTime(c.lastInboundAt)}</time>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className={cn('max-w-24 px-2 py-2', columnClass('assigned'))}>
                      <ContactOwner ownerId={c.ownerId} />
                    </TableCell>
                    <TableCell className="px-1 py-2">{actions(c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul aria-label="Contacts" className="divide-y divide-border md:hidden">
            {data.map((c) => (
              <li
                key={c.id}
                className={cn(
                  'flex items-start gap-2 px-2 py-3',
                  (selected.includes(c.id) || preview === c.id) && 'bg-primary-soft',
                )}
              >
                {choice(c, true)}
                <div className="min-w-0 flex-1">
                  {identity(c, true)}
                  <div className="ml-11 mt-2 flex flex-wrap gap-2">
                    {visible.tags ? <TagBadges tags={c.tags} max={2} /> : null}
                    {visible.eligibility ? <DirectoryEligibility contactId={c.id} /> : null}
                  </div>
                  {visible.lastInbound && c.lastInboundAt ? (
                    <p className="ml-11 mt-1 text-xs text-muted">
                      Last incoming {relativeTime(c.lastInboundAt)}
                    </p>
                  ) : null}
                </div>
                {actions(c)}
              </li>
            ))}
          </ul>
        </>
      )}
      {selected.length && bulkActions ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-2 border-t border-border bg-primary-soft px-3 py-2"
        >
          <span aria-live="polite" className="text-sm font-medium">
            {selected.length} selected
          </span>
          {bulkActions}
          <Button variant="ghost" size="sm" onClick={() => onSelectionChange([])}>
            Clear selection
          </Button>
        </div>
      ) : null}
      {!error ? <Pagination {...pagination} className="border-t border-border px-3 py-3" /> : null}
    </section>
  )
}
