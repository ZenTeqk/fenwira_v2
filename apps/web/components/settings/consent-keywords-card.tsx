'use client'

import { type ConsentSettings } from '@fenwira/contracts'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  Input,
  toast,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { get, patch } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

const split = (s: string) =>
  s
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)

/** Settings → Workspace: whole-message keywords that opt contacts out of / into marketing. */
export function ConsentKeywordsCard({ canManage }: { canManage: boolean }) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  const key = keys.tenant(tenantId, 'consent-settings')
  const settings = useQuery({
    queryKey: key,
    queryFn: () =>
      get<{ data: ConsentSettings }>('/workspace/consent-settings').then((r) => r.data),
  })
  const [optOut, setOptOut] = useState('')
  const [optIn, setOptIn] = useState('')
  const [reply, setReply] = useState('')
  useEffect(() => {
    if (!settings.data) return
    setOptOut(settings.data.optOutKeywords.join(', '))
    setOptIn(settings.data.optInKeywords.join(', '))
    setReply(settings.data.optOutReply ?? '')
  }, [settings.data])
  const save = useMutation({
    mutationFn: () =>
      patch('/workspace/consent-settings', {
        optOutKeywords: split(optOut),
        optInKeywords: split(optIn),
        optOutReply: reply.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Keywords saved')
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
  return (
    <Card>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <CardHeader>
          <CardTitle>Opt-out keywords</CardTitle>
          <CardDescription>
            When a contact&apos;s whole message is one of these words, their marketing consent
            changes automatically and the change is logged.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FormError error={save.error} />
          <Field label="Opt-out keywords" hint="Comma separated, not case-sensitive">
            <Input
              value={optOut}
              onChange={(e) => setOptOut(e.target.value)}
              disabled={!canManage}
            />
          </Field>
          <Field label="Opt-in keywords" hint="Comma separated, not case-sensitive">
            <Input value={optIn} onChange={(e) => setOptIn(e.target.value)} disabled={!canManage} />
          </Field>
          <Field label="Reply after an opt-out" hint="Leave empty to send no reply.">
            <Input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              disabled={!canManage}
              maxLength={1000}
            />
          </Field>
        </CardContent>
        {canManage ? (
          <CardFooter className="justify-end">
            <Button type="submit" loading={save.isPending}>
              Save keywords
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  )
}
