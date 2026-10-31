'use client'

import { Alert, Button, textLink } from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MailCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef } from 'react'
import { AuthCard } from '@/components/auth/auth-card'
import { FormError } from '@/components/auth/form-error'
import { useMe } from '@/components/session/session-provider'
import { post } from '@/lib/api/client'

function VerifyWithToken({ token }: { token: string }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const verify = useMutation({
    mutationFn: () => post('/auth/email/verify', { token }, { tenant: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    verify.mutate()
  }, [verify])

  if (verify.isSuccess) {
    return (
      <AuthCard title="Email verified" description="Your email address is confirmed.">
        <Button onClick={() => router.replace('/onboarding')}>Continue</Button>
      </AuthCard>
    )
  }
  return (
    <AuthCard title="Verifying your email…">
      <FormError error={verify.error} />
      {verify.isError ? (
        <Link href="/verify-email" className={`text-sm font-medium ${textLink}`}>
          Send a new link
        </Link>
      ) : null}
    </AuthCard>
  )
}

function PendingVerification() {
  const { data: me } = useMe()
  const router = useRouter()
  const resend = useMutation({
    mutationFn: () => post('/auth/email/resend', {}, { tenant: false }),
  })

  useEffect(() => {
    if (me === null) router.replace('/login?next=/verify-email')
    if (me?.user.emailVerified) router.replace(me.memberships.length ? '/dashboard' : '/onboarding')
  }, [me, router])

  return (
    <AuthCard
      title="Check your inbox"
      description={
        <>
          We sent a verification link to{' '}
          <strong className="text-fg">{me?.user.email ?? 'your email'}</strong>. Open it to
          continue.
        </>
      }
    >
      <div className="flex items-center gap-3 rounded-md bg-action-primary-subtle p-3 text-base text-fg">
        <MailCheck className="size-5 shrink-0 text-accent-conversation-fg" aria-hidden="true" />
        The link expires in 24 hours.
      </div>
      {resend.isSuccess ? <Alert tone="success" title="A new link is on its way." /> : null}
      <FormError error={resend.error} />
      <Button variant="secondary" onClick={() => resend.mutate()} loading={resend.isPending}>
        Resend verification email
      </Button>
    </AuthCard>
  )
}

function VerifyEmail() {
  const token = useSearchParams().get('token')
  return token ? <VerifyWithToken token={token} /> : <PendingVerification />
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  )
}
