'use client'

import { AI_TONES, type AiTone, type UpdateAiSettingsRequest } from '@fenwira/contracts'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  Field,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  Textarea,
  toast,
} from '@fenwira/ui'
import { type FormEvent, useEffect, useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { useAiSettings, useUpdateAiSettings } from '@/lib/ai'

const TONE_LABEL: Record<AiTone, { label: string; hint: string }> = {
  FRIENDLY: { label: 'Friendly', hint: 'Warm and conversational' },
  PROFESSIONAL: { label: 'Professional', hint: 'Polite and formal' },
  CONCISE: { label: 'Concise', hint: 'Short and to the point' },
}

/** An illustration of the tone only; real replies come from your documents. */
const EXAMPLE: Record<AiTone, (name: string) => string> = {
  FRIENDLY: (n) => `Hi! Thanks for messaging ${n}. We're open 9am to 6pm on weekdays. See you soon!`,
  PROFESSIONAL: (n) => `Thank you for contacting ${n}. Our opening hours are 9am to 6pm, Monday to Friday.`,
  CONCISE: () => 'Open 9am–6pm, Monday to Friday.',
}

const DEFAULT_FALLBACK =
  "Sorry, I couldn't find the answer to that in our information. Could you rephrase your question?"

type Form = Required<{ [K in keyof UpdateAiSettingsRequest]: NonNullable<UpdateAiSettingsRequest[K]> }>

/** Behaviour (docs/AI_ASSISTANT.md → Settings): business details, tone and the two fixed messages. */
export function BehaviourTab() {
  const { can } = useSession()
  const settings = useAiSettings()
  const save = useUpdateAiSettings()
  const [form, setForm] = useState<Form>({
    businessName: '',
    businessDescription: '',
    tone: 'FRIENDLY',
    fallbackMessage: '',
    handoffMessage: '',
  })
  useEffect(() => {
    const s = settings.data
    if (s)
      setForm({
        businessName: s.businessName ?? '',
        businessDescription: s.businessDescription ?? '',
        tone: s.tone,
        fallbackMessage: s.fallbackMessage ?? '',
        handoffMessage: s.handoffMessage ?? '',
      })
  }, [settings.data])
  if (settings.isLoading) return <Skeleton className="h-96" />
  if (settings.isError) return <ErrorState onRetry={() => settings.refetch()} />
  const editable = can('ai.manage')
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const name = form.businessName.trim() || 'your business'
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(form, { onSuccess: () => toast.success('Behaviour saved') })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle as="h2">How the assistant talks</CardTitle>
          <CardDescription>
            It always answers only from your knowledge. These settings change its voice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={submit}>
            <FormError error={save.error} />
            <fieldset disabled={!editable} className="flex flex-col gap-5">
              <Field label="Business name" hint="How the assistant refers to you.">
                <Input
                  value={form.businessName}
                  maxLength={120}
                  onChange={(e) => set('businessName', e.target.value)}
                />
              </Field>
              <Field label="About the business" hint="One or two sentences of context.">
                <Textarea
                  rows={3}
                  maxLength={1000}
                  value={form.businessDescription}
                  onChange={(e) => set('businessDescription', e.target.value)}
                />
              </Field>
              <div className="flex flex-col gap-2">
                <Label id="ai-tone-label">Tone</Label>
                <RadioGroup
                  aria-labelledby="ai-tone-label"
                  value={form.tone}
                  onValueChange={(v) => set('tone', v as AiTone)}
                  className="grid gap-2 sm:grid-cols-3"
                >
                  {AI_TONES.map((t) => (
                    <label
                      key={t}
                      className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3"
                    >
                      <RadioGroupItem value={t} aria-label={TONE_LABEL[t].label} />
                      <span className="flex flex-col">
                        <span className="font-medium text-slate">{TONE_LABEL[t].label}</span>
                        <span className="text-sm text-secondary">{TONE_LABEL[t].hint}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </div>
              <Field
                label="When it can't find an answer"
                hint="Sent when your knowledge doesn't cover the question. Leave empty for the default."
              >
                <Textarea
                  rows={2}
                  maxLength={500}
                  placeholder={DEFAULT_FALLBACK}
                  value={form.fallbackMessage}
                  onChange={(e) => set('fallbackMessage', e.target.value)}
                />
              </Field>
              <Field
                label="When it hands over to your team"
                hint="Sent when the customer asks for a person or the assistant gives up. Leave empty to send nothing."
              >
                <Textarea
                  rows={2}
                  maxLength={500}
                  placeholder="Thanks! A member of our team will reply shortly."
                  value={form.handoffMessage}
                  onChange={(e) => set('handoffMessage', e.target.value)}
                />
              </Field>
            </fieldset>
            {editable ? (
              <Button type="submit" className="self-start" loading={save.isPending}>
                Save behaviour
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle as="h2">Example reply</CardTitle>
          <CardDescription>A customer asks: “When are you open?”</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 rounded-lg bg-background p-4" aria-live="polite">
          <p className="max-w-9/10 self-start rounded-xl border border-border bg-surface px-3.5 py-2.5 text-message text-slate">
            When are you open?
          </p>
          <div className="flex max-w-9/10 flex-col gap-1 self-end rounded-xl bg-message-outbound px-3.5 py-2.5 text-message text-slate">
            <span className="text-xs font-medium text-secondary">AI</span>
            <p>{EXAMPLE[form.tone](name)}</p>
          </div>
          <p className="text-xs text-secondary">
            Illustration of the tone. Real answers use only your knowledge.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
