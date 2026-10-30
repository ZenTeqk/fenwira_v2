'use client'
import { Button, toast } from '@fenwira/ui'
import { ArrowRight, GitBranch, Tag, FilePlus2, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { post, errorText } from '@/lib/api/client'
import { type FlowTemplateCategory, type Flow } from '@fenwira/contracts'
export function WorkflowStarters({
  onBrowse,
}: {
  onBrowse: (category: FlowTemplateCategory) => void
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false)
  async function blank() {
    setBusy(true)
    try {
      const r = await post<{ data: Flow }>('/flows', { name: 'Untitled workflow' })
      router.push(`/automations/${r.data.id}/edit`)
    } catch (e) {
      toast.error(errorText(e, 'Could not create a workflow.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Workflow starters" className="flex flex-col gap-3">
      <h2 className="text-md font-semibold text-slate">Build your first workflow faster</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            title: 'Route incoming enquiries',
            detail: 'Tag keywords and assign a teammate.',
            icon: GitBranch,
            category: 'LEADS' as const,
          },
          {
            title: 'Follow up contacts',
            detail: 'Wait, then send an eligible follow-up.',
            icon: Tag,
            category: 'FOLLOW_UPS' as const,
          },
          {
            title: 'Start from blank',
            detail: 'Build a custom workflow.',
            icon: FilePlus2,
            category: null,
          },
        ].map((s) => (
          <Button
            key={s.title}
            variant="secondary"
            disabled={busy}
            className="h-auto justify-start gap-3 rounded-lg border-border bg-surface p-4 text-left whitespace-normal"
            onClick={() => (s.category ? onBrowse(s.category) : void blank())}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong">
              <s.icon aria-hidden="true" className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate">{s.title}</span>
              <span className="mt-1 block text-xs font-normal text-muted">{s.detail}</span>
            </span>
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        ))}
      </div>
      <p className="flex items-center gap-2 text-xs text-muted">
        <ShieldCheck aria-hidden="true" className="size-4" />
        Messaging actions check eligibility before sending.
      </p>
    </section>
  )
}
