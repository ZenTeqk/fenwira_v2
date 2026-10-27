'use client'
import { Badge, Button, Field, Input, Modal, ModalContent } from '@fenwira/ui'
import { useQueryClient } from '@tanstack/react-query'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  identityLeft,
  verificationFailure,
  verifyIdentity,
  withIdentity,
} from '@/lib/platform-identity'
import { platformRequest } from '@/lib/platform'
import { usePlatform } from './platform-context'

type Identity = {
  /** Opens the verification dialog; resolves true once verified, false when cancelled. */
  verify: () => Promise<boolean>
  /** Runs a consequential action, verifying inline and retrying once if the check lapsed. */
  run: <T>(action: () => Promise<T>) => Promise<T>
}
const IdentityContext = createContext<Identity>({
  verify: async () => false,
  run: (action) => action(),
})
export const useIdentity = () => useContext(IdentityContext)

/**
 * The short identity check (password + fresh authenticator code, 5 minutes) stays a security
 * control. Password and code live only in this dialog's inputs and are cleared after each attempt.
 */
export function IdentityProvider({ children }: { children: ReactNode }) {
  const me = usePlatform(),
    cache = useQueryClient()
  const [open, setOpen] = useState(false),
    [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [now, setNow] = useState(() => Date.now())
  const pending = useRef<((ok: boolean) => void) | null>(null)
  const left = identityLeft(me?.mfaFreshUntil, now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const settle = (ok: boolean) => {
    pending.current?.(ok)
    pending.current = null
  }
  const verify = useCallback(() => {
    pending.current?.(false)
    setError('')
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      pending.current = resolve
    })
  }, [])
  const run = useCallback(<T,>(action: () => Promise<T>) => withIdentity(action, verify), [verify])
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      cache.setQueryData(['platform', 'me'], await verifyIdentity(password, code))
      setNow(Date.now())
      setOpen(false)
      settle(true)
    } catch (err) {
      setError(verificationFailure(err))
    } finally {
      setPassword('')
      setCode('')
      setBusy(false)
    }
  }
  const minutes = Math.ceil(left / 60_000),
    clock = `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`
  return (
    <IdentityContext.Provider value={{ verify, run }}>
      <section
        aria-label="Identity verification"
        className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-4 py-3"
      >
        {left > 0 ? (
          <Badge tone="success" icon={<ShieldCheck className="size-4" />}>
            Verified for {minutes} {minutes === 1 ? 'minute' : 'minutes'}
            <span className="sr-only"> </span>
            <span aria-hidden="true" className="tabular-nums">
              ({clock})
            </span>
          </Badge>
        ) : (
          <Badge tone="warning" icon={<ShieldAlert className="size-4" />}>
            Identity not verified
          </Badge>
        )}
        <p className="text-sm text-secondary">
          Connecting WhatsApp, approving payments, invoices and billing adjustments need a check
          from the last 5 minutes. You are asked automatically when an action needs it.
        </p>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void verify()}>
          {left > 0 ? 'Verify again' : 'Verify identity'}
        </Button>
      </section>
      <Modal
        open={open}
        onOpenChange={(v) => {
          if (busy) return
          setOpen(v)
          if (!v) {
            setPassword('')
            setCode('')
            settle(false)
          }
        }}
      >
        <ModalContent
          title="Verify your identity"
          description="Enter your operator password and the current code from your authenticator app. The check lasts 5 minutes; the action you started continues automatically afterwards."
        >
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Operator password" required>
              <Input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field
              label="Authenticator code"
              required
              hint="6 digits, from your authenticator app."
            >
              <Input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            {error ? (
              <p role="alert" className="text-sm text-danger-strong">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify and continue'}
            </Button>
          </form>
        </ModalContent>
      </Modal>
      {children}
    </IdentityContext.Provider>
  )
}

/** platformRequest with the inline identity check: a lapsed check opens the dialog, then retries once. */
export function useIdentityRequest() {
  const { run } = useIdentity()
  return useCallback(
    <T,>(...args: Parameters<typeof platformRequest>) => run(() => platformRequest<T>(...args)),
    [run],
  )
}
