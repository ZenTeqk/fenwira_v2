'use client'

import { AlertCircle } from 'lucide-react'
import { Label as LabelPrimitive } from 'radix-ui'
import { type ComponentProps, type ReactElement, cloneElement, isValidElement, useId } from 'react'
import { cn } from '../lib/cn'

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('text-sm font-medium text-slate peer-disabled:opacity-50', className)}
      {...props}
    />
  )
}

type ControlProps = {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  'aria-required'?: boolean
}

export type FieldProps = {
  label: string
  /** Helper text under the control. */
  hint?: string
  /** Error message; marks the control aria-invalid and announces the error. */
  error?: string
  required?: boolean
  className?: string
  children: ReactElement<ControlProps>
}

/** Label + control + hint/error, wired with ids and aria attributes. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const autoId = useId()
  const id = (isValidElement(children) && children.props.id) || `field-${autoId}`
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div data-slot="field" className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="ml-0.5 text-danger-strong" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {cloneElement(children, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-sm text-danger-strong"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  )
}
