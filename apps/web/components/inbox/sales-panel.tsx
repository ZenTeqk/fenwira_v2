'use client'

import { type Conversation, type FollowUp, type Opportunity } from '@fenwira/contracts'
import {
  Button,
  Input,
  Label,
  Modal,
  ModalContent,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  toast,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { FollowUpForm } from '@/components/follow-ups/follow-up-form'
import { useFollowUpActions } from '@/components/follow-ups/follow-up-actions'
import { useSession } from '@/components/session/session-provider'
import { errorText, get, patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import {
  formatDue,
  formatMoney,
  moneyInput,
  parseMoney,
  useContactOpportunities,
  useMembers,
  useSalesOn,
  useSalesStages,
  useWorkspaceTimezone,
} from '@/lib/follow-ups'
import { useRealtimeEvent } from '@/lib/realtime'
import { displayName } from '@/lib/inbox'
import { Collapsible } from './contact-details'

const NO_OWNER = 'none'

/**
 * Inbox right panel → Sales (docs/FOLLOW_UPS_AND_SALES.md → Opportunities): the customer's open
 * opportunity with stage, sales owner and optional expected value. Created only on request; a
 * support conversation is never treated as a lead automatically. Independent of the
 * conversation's status and assignee.
 */
export function SalesSection({ conversation: c }: { conversation: Conversation }) {
  const { tenantId, can, me } = useSession()
  const on = useSalesOn()
  const client = useQueryClient()
  const opportunities = useContactOpportunities(c.contact.id)
  const stages = useSalesStages()
  const owners = useMembers('sales.write')
  const open = opportunities.data?.find((o) => o.status === 'OPEN')
  const history = (opportunities.data ?? []).filter((o) => o.status !== 'OPEN')
  const writable = can('sales.write')
  const [closing, setClosing] = useState<{ stageId: string; name: string } | null>(null)
  const refresh = () => {
    void client.invalidateQueries({ queryKey: keys.tenant(tenantId, 'sales') })
    void client.invalidateQueries({ queryKey: keys.tenant(tenantId, 'follow-ups') })
    void client.invalidateQueries({ queryKey: keys.tenant(tenantId, 'inbox', 'list') })
  }
  const create = useMutation({
    mutationFn: () =>
      post<{ data: Opportunity }>('/opportunities', {
        contactId: c.contact.id,
        conversationId: c.id,
      }),
    onSuccess: () => {
      toast.success('Opportunity created')
      refresh()
    },
    onError: (err) => toast.error(errorText(err)),
  })
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      patch<{ data: Opportunity }>(`/opportunities/${open!.id}`, body),
    onSuccess: () => refresh(),
    onError: (err) => toast.error(errorText(err)),
  })

  if (!on || !can('sales.read')) return null
  const summary = opportunities.isPending ? (
    '…'
  ) : open ? (
    <span className="text-sm text-fg-secondary">{open.stage.name}</span>
  ) : (
    <span className="text-sm text-fg-secondary">None</span>
  )
  const activeStages = (stages.data ?? []).filter((s) => !s.archived)
  return (
    <Collapsible title="Sales" summary={summary}>
      {opportunities.isPending ? (
        <Skeleton className="h-16" />
      ) : opportunities.isError ? (
        <p className="text-xs text-fg-secondary">Sales details couldn’t be loaded.</p>
      ) : !open ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-fg-secondary">
            No open opportunity. Start one only when this customer is a sales lead.
          </p>
          {writable ? (
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              {history.length ? 'Start a new opportunity' : 'Create opportunity'}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <PanelSelect
            label="Stage"
            value={open.stage.id}
            disabled={!writable || update.isPending}
            onChange={(stageId) => {
              const stage = activeStages.find((s) => s.id === stageId)
              if (!stage) return
              if (stage.outcome !== 'OPEN' && open.pendingFollowUps > 0)
                setClosing({ stageId, name: stage.name })
              else update.mutate({ stageId })
            }}
            options={[
              ...(activeStages.some((s) => s.id === open.stage.id)
                ? []
                : [{ value: open.stage.id, label: `${open.stage.name} (archived)` }]),
              ...activeStages.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
          <PanelSelect
            label="Sales owner"
            value={open.owner?.id ?? NO_OWNER}
            disabled={!writable || update.isPending}
            onChange={(v) => update.mutate({ ownerId: v === NO_OWNER ? null : v })}
            options={[
              { value: NO_OWNER, label: 'No owner' },
              ...(open.owner && !owners.data.some((m) => m.userId === open.owner!.id)
                ? [{ value: open.owner.id, label: open.owner.name }]
                : []),
              ...owners.data.map((m) => ({
                value: m.userId,
                label: m.userId === me.user.id ? `${m.name} (you)` : m.name,
              })),
            ]}
          />
          <ExpectedValue
            key={`${open.id}:${open.expectedValueMinor}:${open.currency}`}
            opportunity={open}
            disabled={!writable}
            pending={update.isPending}
            onSave={(value) => update.mutate(value)}
          />
        </div>
      )}
      {history.length ? (
        <p className="text-xs text-fg-secondary">
          Past opportunities:{' '}
          {history
            .slice(0, 3)
            .map(
              (o) =>
                `${o.stage.name}${o.closedAt ? ` (${new Date(o.closedAt).toLocaleDateString()})` : ''}`,
            )
            .join(', ')}
          {history.length > 3 ? ` and ${history.length - 3} more` : ''}
        </p>
      ) : null}
      <CloseDialog
        stage={closing}
        pending={open?.pendingFollowUps ?? 0}
        busy={update.isPending}
        onClose={() => setClosing(null)}
        onConfirm={(cancelPendingFollowUps) => {
          if (!closing) return
          update.mutate(
            { stageId: closing.stageId, cancelPendingFollowUps },
            { onSuccess: () => setClosing(null) },
          )
        }}
      />
    </Collapsible>
  )
}

function PanelSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-fg-secondary">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Optional expected value, typed as decimal text and sent as integer minor units. */
function ExpectedValue({
  opportunity: o,
  disabled,
  pending,
  onSave,
}: {
  opportunity: Opportunity
  disabled: boolean
  pending: boolean
  onSave: (v: { expectedValueMinor: number | null; currency?: string }) => void
}) {
  const id = useId()
  const workspaceCurrency = o.currency ?? 'INR'
  const [currency, setCurrency] = useState(workspaceCurrency)
  const [text, setText] = useState(moneyInput(o.expectedValueMinor, workspaceCurrency))
  const parsed = parseMoney(text, currency)
  const changed =
    parsed !== undefined &&
    (parsed !== o.expectedValueMinor || (parsed !== null && currency !== o.currency))
  if (disabled)
    return (
      <p className="text-sm text-fg">
        <span className="text-xs text-fg-secondary">Expected value: </span>
        {o.expectedValueMinor === null ? 'Not set' : formatMoney(o.expectedValueMinor, o.currency!)}
      </p>
    )
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (changed && parsed !== undefined)
          onSave(
            parsed === null
              ? { expectedValueMinor: null }
              : { expectedValueMinor: parsed, currency },
          )
      }}
    >
      <Label htmlFor={id} className="text-xs text-fg-secondary">
        Expected value (optional)
      </Label>
      <div className="flex min-w-0 gap-2">
        <Input
          id={id}
          inputMode="decimal"
          className="h-8 min-w-0 flex-1 text-sm tabular-nums"
          value={text}
          placeholder="0.00"
          aria-invalid={parsed === undefined || undefined}
          aria-describedby={parsed === undefined ? `${id}-error` : undefined}
          onChange={(e) => setText(e.target.value)}
        />
        <Input
          aria-label="Currency"
          className="h-8 w-16 text-sm uppercase"
          maxLength={3}
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!changed} loading={pending}>
          Save
        </Button>
      </div>
      {parsed === undefined ? (
        <p id={`${id}-error`} className="text-xs text-status-error-fg">
          Enter an amount like 12500 or 12500.50.
        </p>
      ) : null}
    </form>
  )
}

/** Closing never cancels follow-ups silently: the choice is explicit (default: keep them). */
function CloseDialog({
  stage,
  pending,
  busy,
  onClose,
  onConfirm,
}: {
  stage: { stageId: string; name: string } | null
  pending: number
  busy: boolean
  onClose: () => void
  onConfirm: (cancelPendingFollowUps: boolean) => void
}) {
  const [choice, setChoice] = useState<'keep' | 'cancel'>('keep')
  const id = useId()
  useEffect(() => setChoice('keep'), [stage])
  return (
    <Modal open={!!stage} onOpenChange={(o) => (o ? null : onClose())}>
      <ModalContent
        title={`Move to ${stage?.name ?? ''}?`}
        description={`This closes the opportunity. It has ${pending} pending follow-up${pending === 1 ? '' : 's'}.`}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => onConfirm(choice === 'cancel')}>
              Close opportunity
            </Button>
          </>
        }
      >
        <RadioGroup
          value={choice}
          onValueChange={(v) => setChoice(v as 'keep' | 'cancel')}
          aria-label="Pending follow-ups"
          className="flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="keep" id={`${id}-keep`} />
            <Label htmlFor={`${id}-keep`} className="font-normal">
              Keep the follow-ups
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="cancel" id={`${id}-cancel`} />
            <Label htmlFor={`${id}-cancel`} className="font-normal">
              Cancel them (recorded in the audit log)
            </Label>
          </div>
        </RadioGroup>
      </ModalContent>
    </Modal>
  )
}

/**
 * Inbox right panel → Next follow-up: the soonest pending follow-up for this conversation, its
 * due time and assignee, with complete / edit and add.
 */
export function NextFollowUpSection({ conversation: c }: { conversation: Conversation }) {
  const { tenantId, can, me } = useSession()
  const on = useSalesOn()
  const timeZone = useWorkspaceTimezone()
  const actions = useFollowUpActions()
  const [adding, setAdding] = useState(false)
  const pending = useQuery({
    queryKey: keys.tenant(tenantId, 'follow-ups', 'conversation', c.id),
    queryFn: () =>
      get<{ data: FollowUp[] }>(
        `/follow-ups?tab=pending&scope=related&conversationId=${c.id}&limit=5`,
      ).then((r) => r.data),
    enabled: on && can('followups.read'),
  })
  useRealtimeEvent<{ conversationId?: string | null }>(
    'follow_up.changed',
    () => void pending.refetch(),
  )
  if (!on || !can('followups.read')) return null
  const next = pending.data?.[0]
  const more = (pending.data?.length ?? 0) - 1
  return (
    <Collapsible
      title="Next follow-up"
      summary={
        <span className="text-sm text-fg-secondary">
          {pending.isPending
            ? '…'
            : next
              ? next.overdue
                ? 'Overdue'
                : formatDue(next.dueAt, timeZone)
              : 'None'}
        </span>
      }
    >
      {pending.isPending ? (
        <Skeleton className="h-12" />
      ) : pending.isError ? (
        <p className="text-xs text-fg-secondary">Follow-ups couldn’t be loaded.</p>
      ) : next ? (
        <div className="flex flex-col gap-1.5">
          <p className="break-words text-sm font-medium text-fg">{next.title}</p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
            <span className="tabular-nums">{formatDue(next.dueAt, timeZone)}</span>
            {next.overdue ? <StatusBadge status="OVERDUE" /> : null}
            {next.needsReview ? <StatusBadge status="CUSTOMER_REPLIED" /> : null}
          </p>
          <p className="text-xs text-fg-secondary">
            Assigned to {next.assignee.id === me.user.id ? 'you' : next.assignee.name}
          </p>
          {actions.mayChange(next) ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => actions.complete(next)}>
                Complete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => actions.edit(next)}>
                Edit
              </Button>
            </div>
          ) : null}
          {more > 0 ? (
            <Link href="/follow-ups?tab=upcoming" className="text-xs text-fg-secondary underline">
              {more} more pending
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-fg-secondary">No pending follow-up for this conversation.</p>
      )}
      {can('followups.write') ? (
        <Button
          size="sm"
          variant="link"
          className="self-start text-xs"
          onClick={() => setAdding(true)}
        >
          <CalendarPlus aria-hidden="true" />
          Add follow-up
        </Button>
      ) : null}
      {adding ? (
        <FollowUpForm
          open
          onOpenChange={setAdding}
          draft={{
            contact: { id: c.contact.id, label: displayName(c) },
            conversationId: c.id,
            defaultAssigneeId: c.assignee?.id ?? null,
          }}
        />
      ) : null}
      {actions.dialogs}
    </Collapsible>
  )
}
