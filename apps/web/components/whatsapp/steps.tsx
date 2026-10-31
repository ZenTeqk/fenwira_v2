import { type ConnectionStep, type ConnectionStepKey } from '@fenwira/contracts'
import { cn } from '@fenwira/ui'
import { CheckCircle2, Circle, MinusCircle, XCircle } from 'lucide-react'

export const STEP_LABELS: Record<ConnectionStepKey, string> = {
  EXCHANGE: 'Authorize with Meta',
  VERIFY: 'Check permissions',
  FETCH: 'Read account and number',
  UNIQUE: 'Check the number is free',
  STORE: 'Save the connection',
  SUBSCRIBE: 'Subscribe to webhooks',
  REGISTER: 'Register the number',
  VALIDATE: 'Confirm it is live',
}

const ICONS = {
  DONE: <CheckCircle2 className="size-4 text-status-success" aria-hidden="true" />,
  FAILED: <XCircle className="size-4 text-status-error-fg" aria-hidden="true" />,
  SKIPPED: <MinusCircle className="size-4 text-fg-muted" aria-hidden="true" />,
  PENDING: <Circle className="size-4 text-fg-muted" aria-hidden="true" />,
}
const STATUS_TEXT = {
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'not needed',
  PENDING: 'not started',
}

/** The connect flow's steps, showing which one failed and why. */
export function ConnectionSteps({ steps }: { steps: ConnectionStep[] }) {
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Connection steps">
      {steps.map((step) => (
        <li key={step.key} className="flex flex-col gap-0.5">
          <span
            className={cn(
              'flex items-center gap-2 text-sm',
              step.status === 'FAILED' ? 'font-medium text-fg' : 'text-fg-muted',
            )}
          >
            {ICONS[step.status]}
            {STEP_LABELS[step.key]}
            <span className="sr-only">: {STATUS_TEXT[step.status]}</span>
          </span>
          {step.error ? (
            <span className="pl-6 text-sm text-status-error-fg">{step.error.message}</span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
