'use client'

import { type Workspace } from '@fenwira/contracts'
import { BrandMark } from '@/components/shell/brand-mark'
import {
  Button,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useState } from 'react'
import { AuthCard } from '@/components/auth/auth-card'
import { fieldError, FormError } from '@/components/auth/form-error'
import { useMe } from '@/components/session/session-provider'
import { post } from '@/lib/api/client'
import { COUNTRIES, INDIA_TIMEZONE, INDIA_TIMEZONE_LABEL } from '@/lib/locale'

const TENANT_KEY = 'fenwira.tenant'

/** Create a workspace (PRD AU-1); the creator becomes its OWNER. */
export default function OnboardingPage() {
  const { data: me } = useMe()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [country, setCountry] = useState('IN')

  useEffect(() => {
    if (me === null) router.replace('/login?next=/onboarding')
    else if (me && !me.user.emailVerified) router.replace('/verify-email')
  }, [me, router])

  const create = useMutation({
    mutationFn: () =>
      post<{ data: Workspace }>(
        '/tenants',
        { name, country, timezone: INDIA_TIMEZONE },
        { tenant: false },
      ),
    onSuccess: async ({ data }) => {
      try {
        localStorage.setItem(TENANT_KEY, data.id)
      } catch {
        // not remembered; the session provider falls back to the first workspace
      }
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      router.replace('/dashboard')
    },
  })

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <p>
        <BrandMark variant="lockup" size="lg" />
      </p>
      <div className="w-full max-w-md">
        <AuthCard
          title={me?.memberships.length ? 'Create another workspace' : 'Create your workspace'}
          description="A workspace holds your team, WhatsApp numbers and customers. You'll be its owner."
        >
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              create.mutate()
            }}
            className="flex flex-col gap-4"
          >
            {fieldError(create.error, 'name') ? null : <FormError error={create.error} />}
            <Field
              label="Workspace name"
              hint="Usually your company or brand."
              error={fieldError(create.error, 'name')}
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Urban Leaf Home"
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="onboarding-country" className="text-sm font-medium text-slate">
                  Country
                </label>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger id="onboarding-country">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="onboarding-timezone" className="text-sm font-medium text-slate">
                  Timezone
                </label>
                <Input id="onboarding-timezone" readOnly value={INDIA_TIMEZONE_LABEL} />
              </div>
            </div>
            <Button type="submit" loading={create.isPending} disabled={name.trim().length < 2}>
              Create workspace
            </Button>
          </form>
        </AuthCard>
      </div>
    </main>
  )
}
