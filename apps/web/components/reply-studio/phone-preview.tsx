'use client'
import { type DraftGraph } from '@fenwira/contracts'
import { PhoneFrame } from '@fenwira/ui'
import { MessageCircle } from 'lucide-react'
import { draftToPreview } from '@/lib/automation-preview'
export function ReplyPhonePreview({ graph }: { graph: DraftGraph }) {
  const steps = draftToPreview(graph, {
    contact: { name: 'Customer', phone: '', properties: {} },
  }).filter((s) => ['incoming', 'outgoing'].includes(s.kind))
  return (
    <PhoneFrame
      contactName="Your business"
      subtitle="Sample conversation"
      messageCount={steps.length}
    >
      <div className="flex flex-col gap-4 p-4">
        {steps.map((s, i) => (
          <div
            key={`${s.nodeId}-${i}`}
            className={`max-w-full whitespace-pre-wrap rounded-lg px-4 py-2 text-sm ${s.kind === 'incoming' ? 'self-end bg-chat-outgoing text-fg' : 'self-start border border-border-subtle bg-surface text-fg'}`}
          >
            {s.text
              .replace(/\s*\(waits for an answer\)/g, '')
              .replace(
                /⟦missing:([^⟧]+)⟧/g,
                (_, key: string) => `[${key.replace('vars.', '').replaceAll('_', ' ')}]`,
              )}
          </div>
        ))}
        {!steps.length ? (
          <div className="flex flex-col items-center gap-4 rounded-lg bg-surface p-4 text-center text-sm text-fg-secondary">
            <MessageCircle className="size-5 text-fg-subtle" aria-hidden="true" />
            Your messages will appear here as you write.
          </div>
        ) : null}
      </div>
    </PhoneFrame>
  )
}
