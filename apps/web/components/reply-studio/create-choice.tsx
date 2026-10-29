'use client'
import { Button, Modal, ModalContent } from '@fenwira/ui'
import { ArrowRight, GitBranch, MessageCircle } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { MiniChat } from './starter-cards'
export function CreateReplyChoice() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        Create
        <ArrowRight aria-hidden="true" className="size-4" />
      </Button>
      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent
          title="What would you like to create?"
          description="Start small or guide a whole conversation. Nothing runs until you publish."
          className="max-w-2xl"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                title: 'Auto reply',
                aria: 'Create Auto Reply',
                kind: 'AUTO_REPLY',
                icon: MessageCircle,
                preset: 'welcome' as const,
                detail: 'One rule, one response.',
                example: 'For example: share your address when someone asks for your location.',
              },
              {
                title: 'Bot flow',
                aria: 'Create Bot Flow',
                kind: 'BOT_FLOW',
                icon: GitBranch,
                preset: 'product-enquiry' as const,
                detail: 'A guided conversation.',
                example: 'For example: collect a product enquiry, then connect a salesperson.',
              },
            ].map((c) => (
              <Button
                key={c.kind}
                asChild
                variant="secondary"
                className="h-auto flex-col items-stretch gap-4 whitespace-normal rounded-lg border-border p-4 text-left hover:border-border-strong hover:bg-surface hover:shadow-raised"
              >
                <Link aria-label={c.aria} href={`/automations/reply-studio/new?kind=${c.kind}`}>
                  <MiniChat preset={c.preset} />
                  <span className="flex items-center gap-2 text-md font-semibold text-slate">
                    <c.icon aria-hidden="true" className="size-4 text-primary-strong" />
                    {c.title}
                  </span>
                  <span className="text-sm font-medium text-slate">{c.detail}</span>
                  <span className="text-sm font-normal text-secondary">{c.example}</span>
                  <span className="flex items-center justify-between text-sm font-medium text-primary-strong">
                    Get started
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </span>
                </Link>
              </Button>
            ))}
          </div>
        </ModalContent>
      </Modal>
    </>
  )
}
