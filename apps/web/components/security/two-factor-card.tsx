'use client'

import { type TwoFactorSetup } from '@fenwira/contracts'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  toast,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import QRCode from 'qrcode'
import { type FormEvent, useEffect, useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

/** TOTP enrolment (docs/SECURITY.md → 2FA): scan, confirm with a code, keep the backup codes. */
export function TwoFactorCard() {
  const { me } = useSession()
  const queryClient = useQueryClient()
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null)
  const [qr, setQr] = useState('')
  const [code, setCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [disablePassword, setDisablePassword] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const enabled = me.user.twoFactorEnabled

  useEffect(() => {
    if (setup) void QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 180 }).then(setQr)
  }, [setup])

  const refreshMe = () => queryClient.invalidateQueries({ queryKey: keys.me })

  const start = useMutation({
    mutationFn: () => post<{ data: TwoFactorSetup }>('/me/2fa/setup'),
    onSuccess: ({ data }) => setSetup(data),
  })
  const confirm = useMutation({
    mutationFn: () => post<{ data: { backupCodes: string[] } }>('/me/2fa/enable', { code }),
    onSuccess: ({ data }) => {
      setBackupCodes(data.backupCodes)
      setSetup(null)
      setCode('')
      void refreshMe()
    },
  })
  const disable = useMutation({
    mutationFn: () => post('/me/2fa/disable', { password: disablePassword, code: disableCode }),
    onSuccess: () => {
      toast.success('Two-factor authentication is off')
      setDisablePassword('')
      setDisableCode('')
      void refreshMe()
    },
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Two-factor authentication</CardTitle>
          {enabled ? (
            <Badge tone="success" icon={<ShieldCheck />}>
              On
            </Badge>
          ) : (
            <Badge>Off</Badge>
          )}
        </div>
        <CardDescription>
          Ask for a code from an authenticator app when you sign in.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {backupCodes ? (
          <Alert tone="warning" title="Save your backup codes now">
            <p className="mb-2">
              Each code works once if you lose your phone. They won't be shown again.
            </p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm" aria-label="Backup codes">
              {backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {!enabled && !setup ? (
          <>
            <FormError error={start.error} />
            <div>
              <Button onClick={() => start.mutate()} loading={start.isPending}>
                Set up two-factor
              </Button>
            </div>
          </>
        ) : null}

        {!enabled && setup ? (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              confirm.mutate()
            }}
            className="flex flex-col gap-4 md:flex-row md:items-start"
          >
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL generated in the browser
              <img
                src={qr}
                alt="QR code for your authenticator app"
                width={180}
                height={180}
                className="rounded-md border border-border-subtle"
              />
            ) : null}
            <div className="flex flex-1 flex-col gap-3">
              <p className="text-base text-fg">
                Scan the QR code with your authenticator app, or enter this key:
              </p>
              <code className="rounded-sm bg-surface-muted px-2 py-1 font-mono text-sm break-all text-fg">
                {setup.secret}
              </code>
              <FormError error={confirm.error} />
              <Field label="6-digit code">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="max-w-40 font-mono"
                />
              </Field>
              <div>
                <Button
                  type="submit"
                  loading={confirm.isPending}
                  disabled={code.trim().length !== 6}
                >
                  Turn on
                </Button>
              </div>
            </div>
          </form>
        ) : null}

        {enabled ? (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              disable.mutate()
            }}
            className="flex flex-col gap-3 border-t border-border-subtle pt-4"
          >
            <p className="text-sm text-fg-muted">
              To turn it off, confirm your password and a current code.
            </p>
            <FormError error={disable.error} />
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                />
              </Field>
              <Field label="Code or backup code">
                <Input
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  className="font-mono"
                />
              </Field>
            </div>
            <div>
              <Button
                type="submit"
                variant="danger"
                loading={disable.isPending}
                disabled={!disablePassword || disableCode.trim().length < 6}
              >
                Turn off two-factor
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}
