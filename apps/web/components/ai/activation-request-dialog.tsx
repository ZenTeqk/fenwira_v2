'use client'

import { type AiActivationState, createAiActivationRequestSchema } from '@fenwira/contracts'
import {
  Button,
  Field,
  Input,
  Modal,
  ModalContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@fenwira/ui'
import { type FormEvent, useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { useRequestAiActivation } from '@/lib/ai'
import { formatPlanPrice } from './activation-page'

type Errors = Partial<
  Record<'planId' | 'expectedConversations' | 'useCase' | 'contactEmail' | 'contactPhone', string>
>

/** "Request activation": plan, expected volume, use case and contact (prefilled). */
export function ActivationRequestDialog({
  open,
  onOpenChange,
  state,
  initialPlanId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: AiActivationState
  initialPlanId?: string
}) {
  const submit = useRequestAiActivation()
  const [planId, setPlanId] = useState(initialPlanId ?? state.plans[0]?.id ?? '')
  const [conversations, setConversations] = useState('')
  const [useCase, setUseCase] = useState('')
  const [email, setEmail] = useState(state.contact.email)
  const [phone, setPhone] = useState(state.contact.phone ?? '')
  const [errors, setErrors] = useState<Errors>({})

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = createAiActivationRequestSchema.safeParse({
      planId: state.plans.length ? planId || null : null,
      expectedConversations: conversations === '' ? Number.NaN : Number(conversations),
      useCase,
      contactEmail: email.trim(),
      contactPhone: phone.trim() || null,
    })
    if (!parsed.success) {
      const next: Errors = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof Errors
        next[field] ??= field === 'planId' ? 'Choose a plan.' : issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    submit.mutate(parsed.data, {
      onSuccess: () => {
        toast.success('Request sent. The Fenwira team will get back to you.')
        onOpenChange(false)
      },
    })
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title="Request AI Assistant"
        description="The Fenwira team reviews every request and turns the assistant on for your workspace."
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="ai-activation-request" loading={submit.isPending}>
              Send request
            </Button>
          </>
        }
      >
        <form
          id="ai-activation-request"
          className="flex flex-col gap-4"
          onSubmit={onSubmit}
          noValidate
        >
          <FormError error={submit.error} />
          {state.plans.length ? (
            <Field label="Plan" required error={errors.planId}>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger aria-label="Plan">
                  <SelectValue placeholder="Choose a plan" />
                </SelectTrigger>
                <SelectContent>
                  {state.plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} · {formatPlanPrice(plan)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <p className="text-sm text-secondary">
              Pricing isn’t published yet. The team will contact you with a quote.
            </p>
          )}
          <Field
            label="Customer conversations per month"
            hint="A rough estimate is fine."
            required
            error={errors.expectedConversations}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={conversations}
              onChange={(e) => setConversations(e.target.value)}
            />
          </Field>
          <Field
            label="What should the assistant help with?"
            hint="For example: delivery times, prices and opening hours."
            required
            error={errors.useCase}
          >
            <Textarea rows={3} value={useCase} onChange={(e) => setUseCase(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact email" required error={errors.contactEmail}>
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Contact phone" error={errors.contactPhone}>
              <Input
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
          </div>
        </form>
      </ModalContent>
    </Modal>
  )
}
