'use client'

import { type Contact, type FollowUp } from '@fenwira/contracts'
import {
  Button,
  Checkbox,
  Field,
  Input,
  Label,
  Modal,
  ModalContent,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import {
  quickDue,
  toUtcIso,
  useContactOpportunities,
  useMembers,
  useWorkspaceTimezone,
  zonedParts,
} from '@/lib/follow-ups'
import { formatPhone } from '@/lib/phone'

export type FollowUpDraft = {
  contact?: { id: string; label: string }
  conversationId?: string
  /** The conversation's assignee: the default assignee (else the current user). */
  defaultAssigneeId?: string | null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** New follow-up prefilled from a conversation or contact. */
  draft?: FollowUpDraft
  /** Edit an existing pending follow-up (title, note, due time, assignee). */
  editing?: FollowUp
  onSaved?: (f: FollowUp) => void
}

const contactLabel = (c: Pick<Contact, 'name' | 'waProfileName' | 'phoneE164'>) =>
  c.name ?? c.waProfileName ?? formatPhone(c.phoneE164)

/**
 * The compact "New follow-up" form (docs/FOLLOW_UPS_AND_SALES.md → Follow-ups): customer, an
 * optional related conversation and opportunity, title, note, assignee and due date/time in the
 * workspace timezone. Editing changes go through the audited actions (reschedule, reassign).
 */
export function FollowUpForm({ open, onOpenChange, draft, editing, onSaved }: Props) {
  const { tenantId, me, can } = useSession()
  const client = useQueryClient()
  const timeZone = useWorkspaceTimezone()
  const members = useMembers('followups.write')
  const id = useId()
  const initialDue = editing ? zonedParts(editing.dueAt, timeZone) : quickDue('tomorrow', timeZone)
  const [contact, setContact] = useState(draft?.contact)
  const [title, setTitle] = useState(editing?.title ?? '')
  const [note, setNote] = useState(editing?.note ?? '')
  const [date, setDate] = useState(initialDue.date)
  const [time, setTime] = useState(initialDue.time)
  const [assigneeId, setAssigneeId] = useState(
    editing?.assignee.id ?? draft?.defaultAssigneeId ?? me.user.id,
  )
  const [linkOpportunity, setLinkOpportunity] = useState(true)
  const [search, setSearch] = useState('')
  const opportunities = useContactOpportunities(editing ? undefined : contact?.id)
  const openOpportunity = opportunities.data?.find((o) => o.status === 'OPEN')

  useEffect(() => {
    if (!open) return
    const due = editing ? zonedParts(editing.dueAt, timeZone) : quickDue('tomorrow', timeZone)
    setContact(draft?.contact)
    setTitle(editing?.title ?? '')
    setNote(editing?.note ?? '')
    setDate(due.date)
    setTime(due.time)
    setAssigneeId(editing?.assignee.id ?? draft?.defaultAssigneeId ?? me.user.id)
    setSearch('')
    // Reset only when the dialog opens for a new target.
  }, [open, editing?.id])

  const results = useQuery({
    queryKey: keys.tenant(tenantId, 'contacts', 'pick', search),
    queryFn: () =>
      post<{ data: Contact[] }>('/contacts/search', { q: search, limit: 8 }).then((r) => r.data),
    enabled: open && !contact && !editing && search.trim().length >= 2,
  })

  const save = useMutation({
    mutationFn: async (): Promise<FollowUp> => {
      const dueAt = toUtcIso(date, time, timeZone)
      if (!editing) {
        const res = await post<{ data: FollowUp }>('/follow-ups', {
          contactId: contact!.id,
          ...(draft?.conversationId && contact?.id === draft.contact?.id
            ? { conversationId: draft.conversationId }
            : {}),
          ...(openOpportunity && linkOpportunity ? { opportunityId: openOpportunity.id } : {}),
          title,
          ...(note.trim() ? { note } : {}),
          assigneeId,
          dueAt,
        })
        return res.data
      }
      let current = editing
      if (title !== current.title || (note || null) !== current.note)
        current = (
          await patch<{ data: FollowUp }>(`/follow-ups/${current.id}`, {
            title,
            note: note || null,
            version: current.version,
          })
        ).data
      if (dueAt !== new Date(current.dueAt).toISOString())
        current = (
          await post<{ data: FollowUp }>(`/follow-ups/${current.id}/reschedule`, {
            dueAt,
            version: current.version,
          })
        ).data
      if (assigneeId !== current.assignee.id)
        current = (
          await post<{ data: FollowUp }>(`/follow-ups/${current.id}/reassign`, {
            assigneeId,
            version: current.version,
          })
        ).data
      return current
    },
    onSuccess: (f) => {
      toast.success(editing ? 'Follow-up updated' : 'Follow-up created')
      void client.invalidateQueries({ queryKey: keys.tenant(tenantId, 'follow-ups') })
      onSaved?.(f)
      onOpenChange(false)
    },
  })

  const canReassign = !editing || can('followups.manage') || editing.assignee.id === me.user.id
  const assignees = members.data.some((m) => m.userId === assigneeId)
    ? members.data
    : [
        ...members.data,
        ...(editing && editing.assignee.id === assigneeId
          ? [{ userId: editing.assignee.id, name: editing.assignee.name }]
          : []),
      ]
  const valid = !!contact || !!editing
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title={editing ? 'Edit follow-up' : 'New follow-up'}
        description="An internal reminder for your team. Nothing is sent to the customer."
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={`${id}-form`}
              loading={save.isPending}
              disabled={!valid || !title.trim() || !date || !time}
            >
              {editing ? 'Save changes' : 'Create follow-up'}
            </Button>
          </>
        }
      >
        <form
          id={`${id}-form`}
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (valid && title.trim()) save.mutate()
          }}
        >
          <FormError error={save.error} />
          {editing ? (
            <p className="text-sm text-fg-secondary">
              Customer: <span className="font-medium text-fg">{contactLabel(editing.contact)}</span>
            </p>
          ) : contact ? (
            <div className="flex flex-col gap-1.5">
              <Label id={`${id}-customer`}>Customer</Label>
              <div
                className="flex items-center justify-between gap-2 rounded-sm border border-border-control px-3 py-2"
                aria-labelledby={`${id}-customer`}
              >
                <span className="min-w-0 truncate text-base text-fg">{contact.label}</span>
                {draft?.contact?.id === contact.id && draft.conversationId ? null : (
                  <Button variant="link" size="sm" onClick={() => setContact(undefined)}>
                    Change
                  </Button>
                )}
              </div>
              {draft?.conversationId && draft.contact?.id === contact.id ? (
                <p className="text-xs text-fg-secondary">Linked to this conversation.</p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-search`}>Customer</Label>
              <SearchInput
                id={`${id}-search`}
                label="Search customers by name or phone"
                value={search}
                onValueChange={setSearch}
                className="sm:w-full"
              />
              {search.trim().length >= 2 ? (
                <ul aria-label="Matching customers" className="flex flex-col gap-1">
                  {results.isPending ? (
                    <li className="text-sm text-fg-secondary">Searching…</li>
                  ) : results.data?.length ? (
                    results.data.map((c) => (
                      <li key={c.id}>
                        <Button
                          variant="ghost"
                          className="h-auto w-full justify-start px-2 py-1.5 text-left"
                          onClick={() => setContact({ id: c.id, label: contactLabel(c) })}
                        >
                          <span className="min-w-0 truncate">{contactLabel(c)}</span>
                          <span className="ml-auto text-xs text-fg-secondary tabular-nums">
                            {formatPhone(c.phoneE164)}
                          </span>
                        </Button>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-fg-secondary">No customers match.</li>
                  )}
                </ul>
              ) : null}
            </div>
          )}
          {!editing && openOpportunity ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-opportunity`}
                checked={linkOpportunity}
                onCheckedChange={(v) => setLinkOpportunity(v === true)}
              />
              <Label htmlFor={`${id}-opportunity`} className="font-normal">
                Link to the open opportunity ({openOpportunity.stage.name})
              </Label>
            </div>
          ) : null}
          <Field label="Title" required error={fieldError(save.error, 'title')}>
            <Input
              value={title}
              maxLength={200}
              placeholder="e.g. Send the revised quote"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Note" hint="Optional. Visible to your team only.">
            <Textarea
              rows={2}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Due date" required error={fieldError(save.error, 'dueAt')}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Due time" hint={`Workspace time (${timeZone})`} required>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick due times">
            {(
              [
                ['later', 'In 3 hours'],
                ['tomorrow', 'Tomorrow 10:00'],
                ['nextWeek', 'Next week'],
              ] as const
            ).map(([k, label]) => (
              <Button
                key={k}
                variant="secondary"
                size="sm"
                onClick={() => {
                  const due = quickDue(k, timeZone)
                  setDate(due.date)
                  setTime(due.time)
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-assignee`}>Assignee</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId} disabled={!canReassign}>
              <SelectTrigger id={`${id}-assignee`}>
                <SelectValue placeholder="Choose a teammate" />
              </SelectTrigger>
              <SelectContent>
                {assignees.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.userId === me.user.id ? `${m.name} (you)` : m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldError(save.error, 'assigneeId') ? (
              <p className="text-sm text-status-error-fg">{fieldError(save.error, 'assigneeId')}</p>
            ) : null}
          </div>
        </form>
      </ModalContent>
    </Modal>
  )
}
