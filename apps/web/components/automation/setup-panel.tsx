'use client'

import { type Tag } from '@fenwira/contracts'
import { Button, Progress, toast } from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle } from 'lucide-react'
import { useSession } from '@/components/session/session-provider'
import { keys } from '@/lib/api/keys'
import { ApiError, post } from '@/lib/api/client'
import { type SetupItem } from '@/lib/automation'
import { useTags } from '@/lib/contacts'

/**
 * "Set up your automation": what the flow still needs, in order. Each item focuses its step;
 * a suggested tag ("welcomed") can be created and used in one click.
 */
export function SetupPanel({
  items,
  onFocus,
  onUseTag,
  editable,
}: {
  items: SetupItem[]
  onFocus: (nodeId: string) => void
  /** Puts the tag on the step (the builder updates the node's tagIds). */
  onUseTag: (nodeId: string, tagId: string) => void
  editable: boolean
}) {
  const { tenantId, can } = useSession()
  const qc = useQueryClient()
  const tags = useTags()
  const create = useMutation({
    mutationFn: (v: { name: string; nodeId: string }) =>
      post<{ data: Tag }>('/tags', { name: v.name, color: 'PRIMARY' }),
    onSuccess: (r, v) => {
      void qc.invalidateQueries({ queryKey: keys.tenant(tenantId, 'tags') })
      onUseTag(v.nodeId, r.data.id)
      toast.success(`Created the tag “${r.data.name}”.`)
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not create the tag.'),
  })
  if (!items.length) return null
  const done = items.filter((i) => i.done).length
  return (
    <section aria-labelledby="setup-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="setup-title" className="text-md font-semibold text-fg">
          Set up your automation
        </h2>
        <p className="text-sm text-fg-secondary" aria-live="polite">
          {done === items.length
            ? 'Everything is set. Test it, then publish.'
            : `${done} of ${items.length} done. Choose an item to open its step.`}
        </p>
        <Progress value={done} max={items.length} label="Setup progress" />
      </div>
      <ol className="flex flex-col gap-1">
        {items.map((item, i) => {
          const existing = item.suggestedTag
            ? tags.data?.find((t) => t.name.toLowerCase() === item.suggestedTag!.toLowerCase())
            : undefined
          return (
            <li key={`${item.nodeId}-${i}`} className="flex flex-col gap-1">
              <button
                type="button"
                className="flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus-ring"
                onClick={() => onFocus(item.nodeId)}
              >
                {item.done ? (
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-status-success-fg"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                )}
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-fg">
                    {item.label}
                    <span className="sr-only">{item.done ? ' (done)' : ' (to do)'}</span>
                  </span>
                  {item.hint && !item.done ? (
                    <span className="text-xs text-fg-secondary">{item.hint}</span>
                  ) : null}
                </span>
              </button>
              {editable && !item.done && item.suggestedTag && can('contacts.write') ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="ml-8 self-start"
                  loading={create.isPending && create.variables?.nodeId === item.nodeId}
                  onClick={() =>
                    existing
                      ? onUseTag(item.nodeId, existing.id)
                      : create.mutate({ name: item.suggestedTag!, nodeId: item.nodeId })
                  }
                >
                  {existing
                    ? `Use the tag “${existing.name}”`
                    : `Create the tag “${item.suggestedTag}”`}
                </Button>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
