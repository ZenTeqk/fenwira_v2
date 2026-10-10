'use client'
import { platformLoginSchema, platformVerifySchema } from '@fenwira/contracts'
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@fenwira/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { platformCsrf, platformRequest } from '@/lib/platform'
export default function Page() {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [challenge, setChallenge] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const router = useRouter(),
    cache = useQueryClient()
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (!challenge) {
        const result = await platformRequest<{ challengeToken: string }>(
          '/auth/login',
          platformLoginSchema.parse({ email, password }),
        )
        setPassword('')
        setChallenge(result.challengeToken)
      } else {
        const result = await platformRequest<{ csrfToken: string }>(
          '/auth/verify',
          platformVerifySchema.parse({ challengeToken: challenge, code }),
        )
        platformCsrf(result.csrfToken)
        setCode('')
        setChallenge('')
        cache.removeQueries({ queryKey: ['platform'] })
        router.replace('/platform/workspaces')
      }
    } catch {
      setError('Access denied. Check your credentials and current authenticator code.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="w-full max-w-md">
      <h1 className="sr-only">Fenwira Platform sign in</h1>
      <CardHeader>
        <CardTitle as="h2">Platform sign in</CardTitle>
        <p className="text-sm text-secondary">
          Authorized commercial operators. Password and authenticator required.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {!challenge ? (
            <>
              <Field label="Email" required>
                <Input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Password" required>
                <Input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field
              label="Authenticator code"
              required
              hint="Use your current six-digit TOTP code. Backup codes cannot grant platform access."
            >
              <Input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
          )}
          {error ? (
            <p role="alert" className="text-sm text-danger-strong">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? 'Verifying…' : challenge ? 'Verify and enter platform' : 'Continue'}
          </Button>
          {challenge ? (
            <Button
              variant="ghost"
              onClick={() => {
                setChallenge('')
                setCode('')
                setError('')
              }}
            >
              Start again
            </Button>
          ) : null}
          <p className="text-xs text-secondary">
            Access expires after 30 minutes, or 10 minutes without a platform request. Recovery
            requires restricted operator provisioning.
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
