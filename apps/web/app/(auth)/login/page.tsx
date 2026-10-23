'use client'

import { type LoginResult } from '@fenwira/contracts'
import { Button, Field, Input } from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, Suspense, useState } from 'react'
import { AuthCard } from '@/components/auth/auth-card'
import { FormError } from '@/components/auth/form-error'
import { post, setCsrfToken } from '@/lib/api/client'
import { safeNext } from '@/lib/navigation-guard'

export const CHALLENGE_KEY = 'fenwira.mfa-challenge'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const next = safeNext(params.get('next'))

  const login = useMutation({
    mutationFn: () =>
      post<{ data: LoginResult }>('/auth/login', { email, password }, { tenant: false }),
    onSuccess: async ({ data }) => {
      if (data.status === 'TOTP_REQUIRED') {
        sessionStorage.setItem(CHALLENGE_KEY, data.challengeToken)
        router.push(`/two-factor?next=${encodeURIComponent(next)}`)
        return
      }
      setCsrfToken(data.csrfToken)
      // Drop any cached "signed out" session so the app gate loads the new one fresh.
      queryClient.removeQueries({ queryKey: ['me'] })
      router.replace(next)
    },
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate()
  }

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back to Fenwira."
      // Managed Launch Mode: the operator creates workspaces, so no self-serve signup link here
      // (new customers use Request access on fenwira.com).
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError error={login.error} />
        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-primary-strong hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" loading={login.isPending}>
          Sign in
        </Button>
      </form>
    </AuthCard>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
