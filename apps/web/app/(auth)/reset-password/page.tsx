'use client'

import { Alert, Button, Field, Input } from '@fenwira/ui'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { type FormEvent, Suspense, useState } from 'react'
import { AuthCard } from '@/components/auth/auth-card'
import { fieldError, FormError } from '@/components/auth/form-error'
import { post } from '@/lib/api/client'

function ResetForm() {
  const token = useSearchParams().get('token') ?? ''
  const [password, setPassword] = useState('')
  const reset = useMutation({
    mutationFn: () => post('/auth/password/reset', { token, password }, { tenant: false }),
  })

  if (reset.isSuccess) {
    return (
      <AuthCard
        title="Password updated"
        description="Sign in with your new password. Other sessions were signed out."
      >
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </AuthCard>
    )
  }
  return (
    <AuthCard title="Choose a new password">
      {!token ? <Alert tone="danger" title="This link is incomplete. Request a new one." /> : null}
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          reset.mutate()
        }}
        className="flex flex-col gap-4"
      >
        {fieldError(reset.error, 'password') ? null : <FormError error={reset.error} />}
        <Field
          label="New password"
          hint="At least 10 characters."
          error={fieldError(reset.error, 'password')}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" loading={reset.isPending} disabled={!token}>
          Update password
        </Button>
      </form>
    </AuthCard>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  )
}
