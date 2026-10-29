'use client'
import { platformAiSettingsSchema, type PlatformAiSettings } from '@fenwira/contracts'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  Field,
  Input,
  Skeleton,
  StatusBadge,
  SummaryItem,
  Switch,
  Label,
  toast,
} from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { platformRequest } from '@/lib/platform'
import { useIdentityRequest } from './identity'
import { usePlatform } from './platform-shell'

/**
 * AI Assistant for one workspace (docs/AI_ASSISTANT.md → Operator controls). Customers pay by UPI,
 * so the switch and the monthly reply quota are set here by hand; every change is audited.
 */
export function WorkspaceAi({ workspaceId }: { workspaceId: string }) {
  const me = usePlatform()
  const request = useIdentityRequest()
  const queryClient = useQueryClient()
  const key = ['platform', 'ai', workspaceId]
  const canManage = me?.permissions.includes('workspaces.manage') ?? false
  const q = useQuery({
    queryKey: key,
    retry: false,
    queryFn: async () =>
      platformAiSettingsSchema.parse(await platformRequest(`/workspaces/${workspaceId}/ai`)),
  })
  const [enabled, setEnabled] = useState(false)
  const [quota, setQuota] = useState('0')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (q.data) {
      setEnabled(q.data.enabled)
      setQuota(String(q.data.monthlyMessageQuota))
    }
  }, [q.data])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const saved = platformAiSettingsSchema.parse(
        await request<PlatformAiSettings>(`/workspaces/${workspaceId}/ai`, {
          enabled,
          monthlyMessageQuota: Number(quota),
          reason,
        }),
      )
      queryClient.setQueryData(key, saved)
      setReason('')
      toast.success('AI Assistant settings saved')
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">AI Assistant</CardTitle>
        <CardDescription>
          Turn the assistant on for this workspace and set its monthly AI reply allowance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-24" />
        ) : q.isError || !q.data ? (
          <ErrorState onRetry={() => q.refetch()} />
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="grid gap-3 sm:grid-cols-3">
              <SummaryItem label="Status">
                <StatusBadge
                  status={q.data.enabled ? 'ACTIVE' : 'INACTIVE'}
                  label={q.data.enabled ? 'Enabled' : 'Not enabled'}
                />
              </SummaryItem>
              <SummaryItem label="Replies this month">
                {q.data.used.toLocaleString()} of {q.data.monthlyMessageQuota.toLocaleString()}
              </SummaryItem>
              <SummaryItem label="Knowledge sources">{q.data.sources}</SummaryItem>
            </dl>
            {canManage ? (
              <form className="flex flex-col gap-4" onSubmit={submit}>
                <FormError error={error} />
                <div className="flex items-center gap-3">
                  <Switch id="ai-enabled" checked={enabled} onCheckedChange={setEnabled} />
                  <Label htmlFor="ai-enabled">AI Assistant enabled</Label>
                </div>
                <Field
                  label="Monthly AI replies"
                  hint="0 means the assistant hands every conversation to the team."
                >
                  <Input
                    type="number"
                    min={0}
                    max={1000000}
                    value={quota}
                    onChange={(e) => setQuota(e.target.value)}
                  />
                </Field>
                <Field
                  label="Reason"
                  required
                  hint="Recorded in the audit log, e.g. the UPI payment reference."
                >
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <Button
                  type="submit"
                  className="self-start"
                  loading={saving}
                  disabled={reason.trim().length < 3}
                >
                  Save AI settings
                </Button>
              </form>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
