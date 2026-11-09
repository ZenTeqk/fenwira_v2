'use client'

import { SALES_OUTCOMES, type SalesOutcome, type SalesStage } from '@fenwira/contracts'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PermissionState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsPage,
  Skeleton,
  StatusBadge,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Archive, ArchiveRestore } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { errorText, patch, post, put } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useSalesOn, useSalesStages } from '@/lib/follow-ups'

const OUTCOME_LABEL: Record<SalesOutcome, string> = { OPEN: 'Open', WON: 'Won', LOST: 'Lost' }

function Outcome({ outcome }: { outcome: SalesOutcome }) {
  return outcome === 'OPEN' ? (
    <span className="text-sm text-fg-secondary">Open</span>
  ) : (
    <StatusBadge status={outcome} />
  )
}

/**
 * Settings → Sales → Stages (docs/FOLLOW_UPS_AND_SALES.md → Stages). Rename, reorder, add and
 * archive. Stable ids and outcome types; archived stages keep their opportunities' history.
 */
export default function SalesSettingsPage() {
  const { tenantId, can } = useSession()
  const on = useSalesOn()
  const client = useQueryClient()
  const confirm = useConfirm()
  const stages = useSalesStages()
  const manage = can('sales.stages.manage')
  const set = (data: SalesStage[]) =>
    client.setQueryData(keys.tenant(tenantId, 'sales', 'stages'), data)
  const mutate = useMutation({
    mutationFn: (fn: () => Promise<{ data: SalesStage[] }>) => fn(),
    onSuccess: (r) => set(r.data),
    onError: (err) => toast.error(errorText(err)),
  })

  if (!can('sales.read')) return <PermissionState what="sales settings" />
  if (!on)
    return (
      <SettingsPage header={{ title: 'Sales', description: 'Sales stages for opportunities.' }}>
        <EmptyState
          title="Follow-ups and sales are off"
          description="An admin can turn them on in Settings → Workspace."
        />
      </SettingsPage>
    )
  if (stages.isError) return <ErrorState onRetry={() => void stages.refetch()} />

  const active = (stages.data ?? []).filter((s) => !s.archived)
  const archived = (stages.data ?? []).filter((s) => s.archived)
  const move = (index: number, delta: -1 | 1) => {
    const ids = active.map((s) => s.id)
    const [item] = ids.splice(index, 1)
    ids.splice(index + delta, 0, item!)
    mutate.mutate(() => put<{ data: SalesStage[] }>('/sales/stages/order', { ids }))
  }

  return (
    <SettingsPage
      header={{
        title: 'Sales',
        description:
          'Stages for sales opportunities. Each stage is open, won or lost; renaming never changes history.',
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle as="h2">Stages</CardTitle>
          <CardDescription>
            {manage
              ? 'Order runs from first contact to the outcome. Archived stages stay on past opportunities.'
              : 'Only managers can change stages.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {stages.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ol
              aria-label="Active stages"
              className="flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle"
            >
              {active.map((s, i) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="w-6 text-sm text-fg-secondary tabular-nums" aria-hidden="true">
                    {i + 1}
                  </span>
                  {manage ? (
                    <StageName
                      stage={s}
                      onSave={(name) =>
                        mutate.mutate(() =>
                          patch<{ data: SalesStage[] }>(`/sales/stages/${s.id}`, { name }),
                        )
                      }
                    />
                  ) : (
                    <span className="min-w-0 flex-1 text-base text-fg">{s.name}</span>
                  )}
                  <Outcome outcome={s.outcome} />
                  <span className="text-xs text-fg-secondary tabular-nums">
                    {s.opportunityCount}{' '}
                    {s.opportunityCount === 1 ? 'opportunity' : 'opportunities'}
                  </span>
                  {manage ? (
                    <span className="ml-auto flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`Move ${s.name} up`}
                        disabled={i === 0 || mutate.isPending}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`Move ${s.name} down`}
                        disabled={i === active.length - 1 || mutate.isPending}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`Archive ${s.name}`}
                        disabled={mutate.isPending}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: `Archive “${s.name}”?`,
                              description:
                                'It can no longer be chosen. Past opportunities keep it, and you can restore it later.',
                              confirmLabel: 'Archive stage',
                            })
                          )
                            mutate.mutate(() =>
                              patch<{ data: SalesStage[] }>(`/sales/stages/${s.id}`, {
                                archived: true,
                              }),
                            )
                        }}
                      >
                        <Archive aria-hidden="true" />
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {manage ? <AddStage onAdded={set} /> : null}
          {archived.length ? (
            <details className="rounded-md border border-border-subtle px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-fg">
                Archived stages ({archived.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-1">
                {archived.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 text-fg-secondary">{s.name}</span>
                    <Outcome outcome={s.outcome} />
                    {manage ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          mutate.mutate(() =>
                            patch<{ data: SalesStage[] }>(`/sales/stages/${s.id}`, {
                              archived: false,
                            }),
                          )
                        }
                      >
                        <ArchiveRestore aria-hidden="true" />
                        Restore
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </CardContent>
      </Card>
    </SettingsPage>
  )
}

function StageName({ stage, onSave }: { stage: SalesStage; onSave: (name: string) => void }) {
  const [name, setName] = useState(stage.name)
  const commit = () => {
    const next = name.trim()
    if (next && next !== stage.name) onSave(next)
    else setName(stage.name)
  }
  return (
    <Input
      aria-label={`Name of stage ${stage.name}`}
      className="h-8 min-w-32 flex-1 text-base"
      value={name}
      maxLength={40}
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') setName(stage.name)
      }}
    />
  )
}

function AddStage({ onAdded }: { onAdded: (stages: SalesStage[]) => void }) {
  const id = useId()
  const [name, setName] = useState('')
  const [outcome, setOutcome] = useState<SalesOutcome>('OPEN')
  const add = useMutation({
    mutationFn: () => post<{ data: SalesStage[] }>('/sales/stages', { name, outcome }),
    onSuccess: (r) => {
      onAdded(r.data)
      setName('')
      toast.success('Stage added')
    },
  })
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        if (name.trim()) add.mutate()
      }}
    >
      <FormError error={fieldError(add.error, 'name') ? null : add.error} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor={`${id}-name`}>New stage</Label>
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={40}
            placeholder="e.g. Negotiation"
            aria-invalid={!!fieldError(add.error, 'name') || undefined}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-outcome`}>Outcome</Label>
          <Select value={outcome} onValueChange={(v) => setOutcome(v as SalesOutcome)}>
            <SelectTrigger id={`${id}-outcome`} className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SALES_OUTCOMES.map((o) => (
                <SelectItem key={o} value={o}>
                  {OUTCOME_LABEL[o]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" variant="secondary" loading={add.isPending} disabled={!name.trim()}>
          Add stage
        </Button>
      </div>
      {fieldError(add.error, 'name') ? (
        <p className="text-sm text-status-error-fg">{fieldError(add.error, 'name')}</p>
      ) : null}
    </form>
  )
}
