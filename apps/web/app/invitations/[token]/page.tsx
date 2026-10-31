'use client'

import { type InvitationPreview, ROLE_LABELS } from '@fenwira/contracts'
import { BrandMark } from '@/components/shell/brand-mark'
import { Button, Field, Input, Skeleton } from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { AuthCard } from '@/components/auth/auth-card'
import { fieldError, FormError } from '@/components/auth/form-error'
import { useMe } from '@/components/session/session-provider'
import { ApiError, get, post, setCsrfToken } from '@/lib/api/client'

/** Accept a team invitation (PRD TM-1): new account, or sign in as the invited email. */
export default function InvitationPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')

  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      get<{ data: InvitationPreview }>(`/invitations/${token}`, { tenant: false }).then(
        (r) => r.data,
      ),
    retry: false,
  })

  const accept = useMutation({
    mutationFn: () =>
      post<{ data: { tenantId: string; csrfToken?: string } }>(
        `/invitations/${token}/accept`,
        me ? {} : { name, password },
        { tenant: false },
      ),
    onSuccess: async ({ data }) => {
      setCsrfToken(data.csrfToken)
      try {
        localStorage.setItem('fenwira.tenant', data.tenantId)
      } catch {
        // not remembered
      }
      // Drop any cached "signed out" session so the app gate loads the new one fresh.
      queryClient.removeQueries({ queryKey: ['me'] })
      router.replace('/dashboard')
    },
  })

  const shell = (children: React.ReactNode) => (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-4 py-10">
      <p>
        <BrandMark variant="lockup" size="lg" />
      </p>
      <div className="w-full max-w-md">{children}</div>
    </main>
  )

  if (preview.isPending) return shell(<Skeleton className="h-64 w-full" />)
  if (preview.isError) {
    // AuthCard gives the page its h1; the reason stays an announced alert.
    return shell(
      <AuthCard title="Invitation not available">
        <p role="alert" className="text-base text-fg-secondary">
          {preview.error instanceof ApiError
            ? preview.error.message
            : 'This invitation could not be loaded.'}
        </p>
      </AuthCard>,
    )
  }
  const inv = preview.data
  const signedInAsInvitee = me && me.user.email.toLowerCase() === inv.email.toLowerCase()
  const next = encodeURIComponent(`/invitations/${token}`)

  return shell(
    <AuthCard
      title={`Join ${inv.workspaceName}`}
      description={
        <>
          {inv.inviterName} invited <strong className="text-fg">{inv.email}</strong> to join as{' '}
          {ROLE_LABELS[inv.role]}.
        </>
      }
    >
      <FormError error={fieldError(accept.error, 'password') ? null : accept.error} />
      {signedInAsInvitee ? (
        <Button onClick={() => accept.mutate()} loading={accept.isPending}>
          Accept invitation
        </Button>
      ) : me ? (
        <p className="text-base text-fg-muted">
          You're signed in as {me.user.email}. Sign out and sign in as {inv.email} to accept this
          invitation.
        </p>
      ) : inv.existingAccount ? (
        <Button asChild>
          <Link href={`/login?next=${next}`}>Sign in to accept</Link>
        </Button>
      ) : (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            accept.mutate()
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Your name">
            <Input
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Choose a password"
            hint="At least 10 characters."
            error={fieldError(accept.error, 'password')}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" loading={accept.isPending}>
            Create account and join
          </Button>
        </form>
      )}
    </AuthCard>,
  )
}
