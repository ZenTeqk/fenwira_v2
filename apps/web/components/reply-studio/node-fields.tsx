'use client'
import type { Member } from '@fenwira/contracts'
import { Button, Field, Input, Textarea } from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { automationKey, type DraftNode } from '@/lib/automation'
import { useProperties, useTags } from '@/lib/contacts'
import { Choose } from './choose'
export function ReplyNodeFields({
  node,
  onChange,
  readOnly,
}: {
  node: DraftNode
  onChange: (config: Record<string, unknown>) => void
  readOnly?: boolean
}) {
  const c = node.config
  const set = (p: Record<string, unknown>) => onChange({ ...c, ...p })
  const { tenantId, can } = useSession()
  const props = useProperties(),
    tags = useTags()
  const members = useQuery({
    queryKey: automationKey(tenantId, 'members'),
    queryFn: () => get<{ data: Member[] }>('/team/members').then((r) => r.data),
    enabled: node.type === 'action.handover' && can('team.read'),
  })
  const str = (key: string) => String(c[key] ?? '')
  if (node.type === 'condition.business_hours')
    return (
      <p className="text-sm text-fg-secondary">
        Yes when your workspace is open, No when closed. Set your timezone, weekly schedule and
        holidays in Reply Studio → Business hours.
      </p>
    )
  if (node.type === 'action.handover')
    return (
      <div className="flex flex-col gap-4">
        <Choose
          label="Salesperson"
          value={str('userId') || 'unassigned'}
          disabled={readOnly}
          onChange={(v) => {
            const next = { ...c }
            if (v === 'unassigned') delete next.userId
            else next.userId = v
            onChange(next)
          }}
          options={[
            { value: 'unassigned', label: 'Leave for the team to pick up' },
            ...(members.data ?? [])
              .filter((m) => m.status === 'ACTIVE')
              .map((m) => ({ value: m.userId, label: m.name })),
          ]}
        />
        <Choose
          label="Add enquiry tag"
          value={(c.tagIds as string[])?.[0] ?? 'none'}
          disabled={readOnly}
          onChange={(v) => set({ tagIds: v === 'none' ? [] : [v] })}
          options={[
            { value: 'none', label: 'No tag' },
            ...(tags.data ?? []).map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
        <Field
          label="Private enquiry note"
          hint="Use {{vars.field_name}} to include collected answers."
        >
          <Textarea
            value={str('note')}
            readOnly={readOnly}
            onChange={(e) => set({ note: e.target.value })}
          />
        </Field>
        <p className="text-sm text-fg-secondary">
          The conversation passes to your team. Staff confirm availability, price and commitment.
        </p>
      </div>
    )
  if (node.type !== 'action.question' && node.type !== 'action.options') return null
  const options = (c.options as Array<{ value: string; label: string }>) ?? []
  return (
    <div className="flex flex-col gap-4">
      <Field label="Message" hint="Use {{vars.field_name}} to show an earlier answer.">
        <Textarea
          value={str('text')}
          readOnly={readOnly}
          onChange={(e) => set({ text: e.target.value })}
        />
      </Field>
      <Field label="Save answer as" hint="A named field, for example quantity or required_date.">
        <Input
          value={str('field')}
          readOnly={readOnly}
          onChange={(e) => set({ field: e.target.value })}
        />
      </Field>
      {node.type === 'action.question' ? (
        <>
          <Choose
            label="Answer type"
            value={str('answerType') || 'TEXT'}
            disabled={readOnly}
            onChange={(v) => set({ answerType: v })}
            options={['TEXT', 'NUMBER', 'DATE', 'EMAIL'].map((v) => ({
              value: v,
              label:
                v === 'DATE'
                  ? 'Date (YYYY-MM-DD)'
                  : v === 'NUMBER'
                    ? 'Positive number'
                    : v === 'EMAIL'
                      ? 'Email address'
                      : 'Text',
            }))}
          />
          <Choose
            label="Also save to contact property"
            value={str('contactProperty') || 'none'}
            disabled={readOnly}
            onChange={(v) => {
              const next = { ...c }
              if (v === 'none') delete next.contactProperty
              else next.contactProperty = v
              onChange(next)
            }}
            options={[
              { value: 'none', label: 'Only in this enquiry' },
              ...(props.data ?? [])
                .filter((p) => !p.archived)
                .map((p) => ({ value: p.key, label: p.label })),
            ]}
          />
        </>
      ) : (
        <>
          <Choose
            label="Options style"
            value={str('presentation') || 'BUTTONS'}
            disabled={readOnly}
            onChange={(v) => set({ presentation: v })}
            options={[
              { value: 'BUTTONS', label: 'Buttons (up to 3)' },
              { value: 'LIST', label: 'List (up to 10)' },
              { value: 'CTA', label: 'Link and typed answer' },
            ]}
          />
          {str('presentation') === 'CTA' ? (
            <Field label="Link address">
              <Input
                type="url"
                value={str('url')}
                readOnly={readOnly}
                onChange={(e) => set({ url: e.target.value })}
              />
            </Field>
          ) : null}
          {options.map((o, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field label={`Option ${i + 1}`}>
                <Input
                  value={o.label}
                  maxLength={20}
                  readOnly={readOnly}
                  onChange={(e) =>
                    set({
                      options: options.map((v, j) =>
                        j === i ? { ...v, label: e.target.value, value: e.target.value } : v,
                      ),
                    })
                  }
                />
              </Field>
              {!readOnly ? (
                <Button
                  variant="ghost"
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() => set({ options: options.filter((_, j) => j !== i) })}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
          {!readOnly && options.length < (str('presentation') === 'LIST' ? 10 : 3) ? (
            <Button
              variant="secondary"
              onClick={() =>
                set({
                  options: [
                    ...options,
                    { label: 'New option', value: `option_${options.length + 1}` },
                  ],
                })
              }
            >
              Add option
            </Button>
          ) : null}
        </>
      )}
      <details>
        <summary className="text-sm font-medium text-fg">Advanced settings</summary>
        <div className="mt-4">
          <Field
            label="Re-ask invalid answers"
            hint="After this many retries, follow the fallback path and offer a person."
          >
            <Input
              type="number"
              min={0}
              max={10}
              value={Number(c.maxRetries ?? 2)}
              readOnly={readOnly}
              onChange={(e) => set({ maxRetries: Number(e.target.value) })}
            />
          </Field>{' '}
        </div>
      </details>
    </div>
  )
}
