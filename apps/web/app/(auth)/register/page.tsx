'use client'

import { type LoginResult } from '@fenwira/contracts'
import { Button, Field, Input, textLink } from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { AuthCard } from '@/components/auth/auth-card'
import { fieldError, FormError } from '@/components/auth/form-error'
import { ApiError, post, setCsrfToken } from '@/lib/api/client'

export default function RegisterPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const register = useMutation({
    mutationFn: () => post<{ data: LoginResult }>('/auth/register', form, { tenant: false }),
    onSuccess: async ({ data }) => {
      if (data.status === 'AUTHENTICATED') setCsrfToken(data.csrfToken)
      // Drop any cached "signed out" session so the app gate loads the new one fresh.
      queryClient.removeQueries({ queryKey: ['me'] })
      router.replace('/verify-email')
    },
  })
  const hasFieldErrors =
    register.error instanceof ApiError && Boolean(register.error.fieldErrors?.length)

  return (
    <AuthCard
      title="Create your account"
      description="Start with your account, then set up your workspace."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className={`font-medium ${textLink}`}>
            Sign in
          </Link>
        </>
      }
    >
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          register.mutate()
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        {hasFieldErrors ? null : <FormError error={register.error} />}
        <Field label="Your name" error={fieldError(register.error, 'name')}>
          <Input autoComplete="name" value={form.name} onChange={set('name')} required />
        </Field>
        <Field label="Work email" error={fieldError(register.error, 'email')}>
          <Input
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={set('email')}
            required
          />
        </Field>
        <Field
          label="Password"
          hint="At least 10 characters. A passphrase works well."
          error={fieldError(register.error, 'password')}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            required
          />
        </Field>
        <Button type="submit" loading={register.isPending}>
          Create account
        </Button>
      </form>
    </AuthCard>
  )
}
