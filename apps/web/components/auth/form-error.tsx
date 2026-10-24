'use client'
import { Alert, Button, toast } from '@fenwira/ui'
import { ApiError } from '@/lib/api/client'

/** Top-of-form error: message, next step and a copyable request ID. Field errors sit next to inputs. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong. Please try again.'
  const hint = error instanceof ApiError ? error.hint : undefined
  const reference = error instanceof ApiError ? error.correlationId : undefined
  return (
    <Alert tone="danger" title={message}>
      {hint ? <p className="text-sm">{hint}</p> : null}
      {reference ? <RequestId id={reference} /> : null}
    </Alert>
  )
}

export function RequestId({ id }: { id: string }) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2 text-sm">
      Request ID: <span className="font-mono break-all">{id}</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() =>
          void navigator.clipboard
            .writeText(id)
            .then(() => toast.success('Request ID copied'))
            .catch(() => undefined)
        }
      >
        Copy
      </Button>
    </span>
  )
}

export const fieldError = (error: unknown, path: string) =>
  error instanceof ApiError ? error.field(path) : undefined
