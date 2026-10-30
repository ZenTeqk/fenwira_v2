import type { NodeType } from '@fenwira/contracts'
import { cn } from '@fenwira/ui'
import {
  Clock,
  Flag,
  GitBranch,
  MessageCircle,
  Tag,
  UserRound,
  Webhook,
  FileText,
  Search,
  Sparkles,
} from 'lucide-react'
import { kindOf } from '@/lib/automation'

export const NODE_HINT: Record<NodeType, string> = {
  'trigger.message_received': 'When a WhatsApp message arrives',
  'trigger.keyword': 'When a message matches a keyword',
  'trigger.contact_created': 'When a new contact is created',
  'trigger.webhook': 'When your system sends an event',
  'condition.equals': 'Compare two values',
  'condition.contains': 'Check part of a value',
  'condition.exists': 'Check whether a value is set',
  'condition.has_tag': 'Check the contact’s tags',
  'condition.contact_property': 'Check a contact field',
  'action.send_message': 'Send a WhatsApp message',
  'action.send_template': 'Send an approved template',
  'action.add_tag': 'Add tags to the contact',
  'action.remove_tag': 'Remove tags from the contact',
  'action.assign_agent': 'Assign the conversation to a teammate',
  'action.update_contact': 'Update contact information',
  'action.webhook': 'Send data to your system',
  'action.delay': 'Wait for a specified time',
  'action.ai_reply': 'Answer with the AI Assistant',
  'condition.business_hours': 'Check the workspace schedule and holidays',
  'action.question': 'Ask and wait, then save the answer',
  'action.options': 'Offer buttons, a list or a link',
  'action.handover': 'Pass the enquiry and a private note to your team',
  'action.end': 'Finish this automation',
}

/** Shared identity for the library, cards, menus and template gallery (design system → Flow nodes). */
export function NodeSymbol({
  type,
  compact = false,
  bare = false,
  tone,
}: {
  type: NodeType
  compact?: boolean
  /** Icon only, in the surrounding text colour (card header bands). */
  bare?: boolean
  /** `brand`: primary-soft tile with a primary-strong icon (template gallery). */
  tone?: 'brand'
}) {
  const kind = kindOf(type)
  const Icon =
    type === 'action.ai_reply'
      ? Sparkles
      : type === 'action.delay'
        ? Clock
        : type === 'action.end'
          ? Flag
          : type.includes('webhook')
            ? Webhook
            : type.includes('tag')
              ? Tag
              : type === 'action.send_template'
                ? FileText
                : type.includes('contact') || type === 'action.assign_agent'
                  ? UserRound
                  : kind === 'condition'
                    ? GitBranch
                    : type === 'trigger.keyword'
                      ? Search
                      : MessageCircle
  if (bare) return <Icon aria-hidden="true" className="size-3.5 shrink-0" />
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg',
        compact ? 'size-7' : 'size-9',
        tone === 'brand'
          ? 'bg-primary-soft text-primary-strong'
          : {
              trigger: 'bg-inverse text-inverse-fg',
              message: 'bg-primary-soft text-primary-strong',
              condition: 'bg-warning-soft text-warning-strong',
              action: 'bg-info-soft text-info-strong',
              ai: 'bg-accent-automation-bg text-accent-automation-fg',
            }[kind],
      )}
    >
      <Icon className={compact ? 'size-4' : 'size-5'} />
    </span>
  )
}
