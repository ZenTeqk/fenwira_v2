'use client'

import { type AiOverview } from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  StatusBadge,
  toast,
} from '@fenwira/ui'
import { CheckCircle2, Circle } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { errorText } from '@/lib/api/client'
import { usePauseAssistant, useTurnOnAssistant } from '@/lib/ai'

const CHECKS: Array<{
  key: keyof AiOverview['readiness']
  done: string
  todo: string
  action?: { label: string; tab?: string; href?: string }
}> = [
  {
    key: 'knowledge',
    done: 'Knowledge added',
    todo: 'Add at least one document, FAQ or text',
    action: { label: 'Add knowledge', tab: 'knowledge' },
  },
  {
    key: 'businessInfo',
    done: 'Business details filled in',
    todo: 'Add your business name',
    action: { label: 'Open Behaviour', tab: 'behaviour' },
  },
  {
    key: 'whatsapp',
    done: 'WhatsApp number connected',
    todo: 'Connect a WhatsApp number',
    action: { label: 'WhatsApp settings', href: '/integrations/whatsapp' },
  },
  {
    key: 'quota',
    done: 'AI replies available this month',
    todo: 'This month’s AI replies are used up',
  },
]

/** On/off, the readiness checklist, usage against quota and the managed flow (AI_ASSISTANT.md). */
export function OverviewTab({ overview, onGo }: { overview: AiOverview; onGo: (tab: string) => void }) {
  const { can } = useSession()
  const turnOn = useTurnOnAssistant()
  const pause = usePauseAssistant()
  const flow = overview.managedFlow
  const active = flow?.status === 'ACTIVE'
  const canSwitch = can('ai.manage') && can('automations.publish')
  const { used, quota } = overview.usage

  const onTurnOn = () =>
    turnOn.mutate(undefined, {
      onSuccess: () => toast.success('AI Assistant is on. It will answer new customer messages.'),
      onError: (err) => toast.error(errorText(err)),
    })
  const onPause = () =>
    pause.mutate(undefined, {
      onSuccess: () => toast.success('AI Assistant paused. Your team handles new messages.'),
      onError: (err) => toast.error(errorText(err)),
    })

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle as="h2">Assistant status</CardTitle>
              <CardDescription>
                When it’s on, the assistant answers new WhatsApp messages from your knowledge and
                hands over to your team when it can’t help.
              </CardDescription>
            </div>
            <StatusBadge
              status={active ? 'ACTIVE' : flow ? 'PAUSED' : 'INACTIVE'}
              label={active ? 'On' : flow ? 'Paused' : 'Off'}
            />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canSwitch ? (
            <div className="flex flex-wrap items-center gap-3">
              {active ? (
                <Button variant="secondary" loading={pause.isPending} onClick={onPause}>
                  Pause
                </Button>
              ) : (
                <Button
                  loading={turnOn.isPending}
                  disabled={!overview.readiness.knowledge}
                  onClick={onTurnOn}
                >
                  Turn on AI Assistant
                </Button>
              )}
              {!active && !overview.readiness.knowledge ? (
                <p className="text-sm text-secondary">Add knowledge first, then turn it on.</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-secondary">
              Ask a workspace owner or admin to turn the assistant on or off.
            </p>
          )}
          {flow ? (
            <p className="text-sm text-secondary">
              It runs as the managed “AI assistant” automation (low priority, so keyword flows
              still win).{' '}
              <Link
                href={`/automations/${flow.id}`}
                className="font-medium text-primary-strong underline-offset-4 hover:underline"
              >
                Edit in Automations
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">AI replies this month</CardTitle>
          <CardDescription>Each answer the assistant writes counts once.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-2xl font-semibold text-slate">
            {used.toLocaleString()}{' '}
            <span className="text-base font-normal text-secondary">
              of {quota.toLocaleString()}
            </span>
          </p>
          <Progress label="AI replies used this month" value={used} max={Math.max(quota, 1)} />
          {quota > 0 && used >= quota ? (
            <Alert tone="warning">
              The assistant hands every new conversation to your team until next month or until
              your allowance is raised.
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle as="h2">Readiness</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y divide-border">
            {CHECKS.map((c) => {
              const ok = overview.readiness[c.key]
              const Icon = ok ? CheckCircle2 : Circle
              return (
                <li key={c.key} className="flex flex-wrap items-center gap-3 py-3">
                  <Icon
                    className={ok ? 'size-5 text-success-strong' : 'size-5 text-muted'}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 text-slate">
                    {ok ? c.done : c.todo}
                    <span className="sr-only">{ok ? ' (done)' : ' (to do)'}</span>
                  </span>
                  {!ok && c.action ? (
                    c.action.href ? (
                      <Button asChild variant="tertiary" size="sm">
                        <Link href={c.action.href}>{c.action.label}</Link>
                      </Button>
                    ) : (
                      <Button variant="tertiary" size="sm" onClick={() => onGo(c.action!.tab!)}>
                        {c.action.label}
                      </Button>
                    )
                  ) : null}
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
