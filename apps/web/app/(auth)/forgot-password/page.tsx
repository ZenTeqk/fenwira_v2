'use client'

import { Alert, Button, Field, Input, textLink } from '@fenwira/ui'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { type FormEvent, useState } from 'react'
import { AuthCard } from '@/components/auth/auth-card'
import { FormError } from '@/components/auth/form-error'
import { post } from '@/lib/api/client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const request = useMutation({
    mutationFn: () => post('/auth/password/forgot', { email }, { tenant: false }),
  })

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we'll send you a link to choose a new password."
      footer={
        <Link href="/login" className={`font-medium ${textLink}`}>
          Back to sign in
        </Link>
      }
    >
      {request.isSuccess ? (
        <Alert tone="success" title="Check your inbox">
          If an account exists for {email}, a reset link is on its way. It expires in 1 hour.
        </Alert>
      ) : (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            request.mutate()
          }}
          className="flex flex-col gap-4"
        >
          <FormError error={request.error} />
          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" loading={request.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  )
}
