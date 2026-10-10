'use client'

import { type LoginResult } from '@fenwira/contracts'
import { Button, Field, Input } from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, Suspense, useEffect, useState } from 'react'
import { AuthCard } from '@/components/auth/auth-card'
import { FormError } from '@/components/auth/form-error'
import { post, setCsrfToken } from '@/lib/api/client'
import { safeNext } from '@/lib/navigation-guard'
import { CHALLENGE_KEY } from '../login/page'

function TwoFactorForm() {
  const router = useRouter()
  const params = useSearchParams()
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<string | null>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem(CHALLENGE_KEY)
    if (!stored) router.replace('/login')
    setChallenge(stored)
  }, [router])

  const verify = useMutation({
    mutationFn: () =>
      post<{ data: LoginResult }>(
        '/auth/2fa/verify',
        { challengeToken: challenge, code: code.trim() },
        { tenant: false },
      ),
    onSuccess: async ({ data }) => {
      if (data.status !== 'AUTHENTICATED') return
      sessionStorage.removeItem(CHALLENGE_KEY)
      setCsrfToken(data.csrfToken)
      // Drop any cached "signed out" session so the app gate loads the new one fresh.
      queryClient.removeQueries({ queryKey: ['me'] })
      router.replace(safeNext(params.get('next')))
    },
  })

  return (
    <AuthCard
      title="Two-factor authentication"
      description="Enter the 6-digit code from your authenticator app, or one of your backup codes."
      footer={
        <Link href="/login" className="font-medium text-primary-strong hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          verify.mutate()
        }}
        className="flex flex-col gap-4"
      >
        <FormError error={verify.error} />
        <Field label="Authentication code">
          <Input
            inputMode="text"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            className="font-mono"
          />
        </Field>
        <Button
          type="submit"
          loading={verify.isPending}
          disabled={!challenge || code.trim().length < 6}
        >
          Verify
        </Button>
      </form>
    </AuthCard>
  )
}

export default function TwoFactorPage() {
  return (
    <Suspense>
      <TwoFactorForm />
    </Suspense>
  )
}
