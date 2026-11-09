'use client'

import { type FollowUp } from '@fenwira/contracts'
import {
  Button,
  Field,
  Input,
  Label,
  Modal,
  ModalContent,
  type RowAction,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { errorText, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { quickDue, toUtcIso, useMembers, useWorkspaceTimezone, zonedParts } from '@/lib/follow-ups'
import { FollowUpForm } from './follow-up-form'

type Dialog = { kind: 'reschedule' | 'reassign' | 'edit'; followUp: FollowUp } | null

/**
 * Complete, reschedule, reassign, edit, mark reviewed and cancel, through the audited endpoints
 * with the follow-up's version (a stale view gets "changed in the meantime" instead of
 * overwriting). Returns the row-action builder and the dialogs to render once.
 */
export function useFollowUpActions() {
  const { tenantId, can, me } = useSession()
  const client = useQueryClient()
  const confirm = useConfirm()
  const [dialog, setDialog] = useState<Dialog>(null)
  const refresh = () =>
    void client.invalidateQueries({ queryKey: keys.tenant(tenantId, 'follow-ups') })
  const act = useMutation({
    mutationFn: ({ f, action }: { f: FollowUp; action: 'complete' | 'cancel' | 'reviewed' }) =>
      post(`/follow-ups/${f.id}/${action}`, { version: f.version }),
    onSuccess: (_r, { action }) => {
      toast.success(
        action === 'complete'
          ? 'Follow-up completed'
          : action === 'cancel'
            ? 'Follow-up cancelled'
            : 'Marked as reviewed',
      )
      refresh()
    },
    onError: (err) => {
      toast.error(errorText(err))
      refresh()
    },
  })
  const mayChange = (f: FollowUp) =>
    can('followups.write') &&
    f.status === 'PENDING' &&
    (can('followups.manage') || f.assignee.id === me.user.id || f.createdBy?.id === me.user.id)
  const mayReassign = (f: FollowUp) =>
    mayChange(f) && (can('followups.manage') || f.assignee.id === me.user.id)

  const actionsFor = (f: FollowUp): RowAction[] => {
    if (!mayChange(f)) return []
    return [
      { label: 'Complete', onSelect: () => act.mutate({ f, action: 'complete' }) },
      { label: 'Reschedule', onSelect: () => setDialog({ kind: 'reschedule', followUp: f }) },
      ...(mayReassign(f)
        ? [{ label: 'Reassign', onSelect: () => setDialog({ kind: 'reassign', followUp: f }) }]
        : []),
      { label: 'Edit', onSelect: () => setDialog({ kind: 'edit', followUp: f }) },
      ...(f.needsReview
        ? [{ label: 'Mark reviewed', onSelect: () => act.mutate({ f, action: 'reviewed' }) }]
        : []),
      {
        label: 'Cancel follow-up',
        destructive: true,
        onSelect: async () => {
          if (
            await confirm({
              title: 'Cancel this follow-up?',
              description: `“${f.title}” will no longer remind anyone. This is recorded in the audit log.`,
              confirmLabel: 'Cancel follow-up',
              cancelLabel: 'Keep it',
              destructive: true,
            })
          )
            act.mutate({ f, action: 'cancel' })
        },
      },
    ]
  }

  const dialogs = (
    <>
      <RescheduleDialog
        followUp={dialog?.kind === 'reschedule' ? dialog.followUp : null}
        onClose={() => setDialog(null)}
        onDone={refresh}
      />
      <ReassignDialog
        followUp={dialog?.kind === 'reassign' ? dialog.followUp : null}
        onClose={() => setDialog(null)}
        onDone={refresh}
      />
      {dialog?.kind === 'edit' ? (
        <FollowUpForm
          open
          onOpenChange={(open) => (open ? null : setDialog(null))}
          editing={dialog.followUp}
        />
      ) : null}
    </>
  )
  return {
    actionsFor,
    dialogs,
    pending: act.isPending,
    mayChange,
    complete: (f: FollowUp) => act.mutate({ f, action: 'complete' }),
    edit: (f: FollowUp) => setDialog({ kind: 'edit', followUp: f }),
  }
}

function RescheduleDialog({
  followUp,
  onClose,
  onDone,
}: {
  followUp: FollowUp | null
  onClose: () => void
  onDone: () => void
}) {
  const timeZone = useWorkspaceTimezone()
  const id = useId()
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  useEffect(() => {
    if (!followUp) return
    const due = zonedParts(followUp.dueAt, timeZone)
    setDate(due.date)
    setTime(due.time)
  }, [followUp, timeZone])
  const save = useMutation({
    mutationFn: () =>
      post(`/follow-ups/${followUp!.id}/reschedule`, {
        dueAt: toUtcIso(date, time, timeZone),
        version: followUp!.version,
      }),
    onSuccess: () => {
      toast.success('Follow-up rescheduled')
      onDone()
      onClose()
    },
  })
  return (
    <Modal open={!!followUp} onOpenChange={(open) => (open ? null : onClose())}>
      <ModalContent
        title="Reschedule follow-up"
        description={followUp?.title}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={`${id}-form`}
              loading={save.isPending}
              disabled={!date || !time}
            >
              Reschedule
            </Button>
          </>
        }
      >
        <form
          id={`${id}-form`}
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <FormError error={save.error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Due date" required>
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
        </form>
      </ModalContent>
    </Modal>
  )
}

function ReassignDialog({
  followUp,
  onClose,
  onDone,
}: {
  followUp: FollowUp | null
  onClose: () => void
  onDone: () => void
}) {
  const { me } = useSession()
  const members = useMembers('followups.write')
  const id = useId()
  const [assigneeId, setAssigneeId] = useState('')
  useEffect(() => {
    if (followUp) setAssigneeId(followUp.assignee.id)
  }, [followUp])
  const save = useMutation({
    mutationFn: () =>
      post(`/follow-ups/${followUp!.id}/reassign`, { assigneeId, version: followUp!.version }),
    onSuccess: () => {
      toast.success('Follow-up reassigned')
      onDone()
      onClose()
    },
  })
  return (
    <Modal open={!!followUp} onOpenChange={(open) => (open ? null : onClose())}>
      <ModalContent
        title="Reassign follow-up"
        description={followUp?.title}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={`${id}-form`}
              loading={save.isPending}
              disabled={!assigneeId || assigneeId === followUp?.assignee.id}
            >
              Reassign
            </Button>
          </>
        }
      >
        <form
          id={`${id}-form`}
          className="flex flex-col gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <FormError error={save.error} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-assignee`}>Assign to</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger id={`${id}-assignee`}>
                <SelectValue placeholder="Choose a teammate" />
              </SelectTrigger>
              <SelectContent>
                {members.data.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.userId === me.user.id ? `${m.name} (you)` : m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-fg-secondary">
              They are notified, and reminded when it becomes due.
            </p>
          </div>
        </form>
      </ModalContent>
    </Modal>
  )
}
