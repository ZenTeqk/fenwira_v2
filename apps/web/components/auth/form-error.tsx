import { Alert } from '@fenwira/ui'
import { ApiError } from '@/lib/api/client'

/** Top-of-form error. Field errors are shown next to their inputs via ApiError.field(). */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong. Please try again.'
  const reference = error instanceof ApiError ? error.correlationId : undefined
  return (
    <Alert tone="danger" title={message}>
      {reference ? (
        <span className="text-sm">
          Reference: <span className="font-mono">{reference}</span>
        </span>
      ) : null}
    </Alert>
  )
}

export const fieldError = (error: unknown, path: string) =>
  error instanceof ApiError ? error.field(path) : undefined
