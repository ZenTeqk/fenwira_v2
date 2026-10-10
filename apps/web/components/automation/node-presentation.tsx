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
} from 'lucide-react'
import { categoryOf } from '@/lib/automation'

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
  'action.end': 'Finish this automation',
}

/** Shared category identity for the library, nodes and selected-step panel. */
export function NodeSymbol({ type, compact = false }: { type: NodeType; compact?: boolean }) {
  const category = categoryOf(type)
  const Icon =
    type === 'action.delay'
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
                : category === 'condition'
                  ? GitBranch
                  : type === 'trigger.keyword'
                    ? Search
                    : MessageCircle
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg',
        compact ? 'size-7' : 'size-9',
        category === 'message'
          ? 'bg-primary-soft text-primary-strong'
          : category === 'condition' || type === 'action.delay'
            ? 'bg-warning-soft text-warning-strong'
            : category === 'trigger'
              ? 'bg-neutral-soft text-slate'
              : 'bg-info-soft text-info-strong',
      )}
    >
      <Icon className={compact ? 'size-4' : 'size-5'} />
    </span>
  )
}
