import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  Check,
  CheckCheck,
  CheckCircle2,
  Circle,
  CircleDashed,
  Clock,
  FileEdit,
  Hand,
  Loader2,
  type LucideProps,
  Minus,
  Pause,
  PlugZap,
  SkipForward,
  Square,
  XCircle,
  Zap,
  Sparkles,
} from 'lucide-react'
import { type ComponentType } from 'react'
import { cn } from '../lib/cn'
import { Badge, type BadgeTone } from './badge'

type StatusPreset = { tone: BadgeTone; label: string; icon: ComponentType<LucideProps> }

/** Read receipt: the delivered double tick drawn heavier, so read ≠ delivered without color. */
function ReadTicks(props: LucideProps) {
  return <CheckCheck strokeWidth={3} {...props} />
}

/**
 * The single mapping from domain status to tone, label and icon. Feature code passes a status;
 * it never picks a color (docs/DESIGN_SYSTEM.md → Core components).
 */
export const STATUS_PRESETS = {
  // Connections
  CONNECTED: { tone: 'success', label: 'Connected', icon: CheckCircle2 },
  DISCONNECTED: { tone: 'danger', label: 'Disconnected', icon: PlugZap },
  ERROR: { tone: 'danger', label: 'Error', icon: XCircle },
  FLAGGED: { tone: 'warning', label: 'Flagged', icon: AlertTriangle },
  RESTRICTED: { tone: 'danger', label: 'Restricted', icon: Ban },
  // Credentials
  VALID: { tone: 'success', label: 'Valid', icon: CheckCircle2 },
  EXPIRING: { tone: 'warning', label: 'Expiring soon', icon: Clock },
  INVALID: { tone: 'danger', label: 'Invalid', icon: XCircle },
  // WhatsApp quality rating (Meta's High / Medium / Low)
  GREEN: { tone: 'success', label: 'High quality', icon: CheckCircle2 },
  YELLOW: { tone: 'warning', label: 'Medium quality', icon: AlertTriangle },
  RED: { tone: 'danger', label: 'Low quality', icon: XCircle },
  UNKNOWN: { tone: 'neutral', label: 'Quality unknown', icon: CircleDashed },
  // Messages
  RECEIVED: { tone: 'neutral', label: 'Received', icon: CheckCircle2 },
  CREATED: { tone: 'neutral', label: 'Created', icon: CircleDashed },
  QUEUED: { tone: 'neutral', label: 'Queued', icon: Clock },
  SENDING: { tone: 'info', label: 'Sending', icon: Loader2 },
  SENT: { tone: 'info', label: 'Sent', icon: Check },
  DELIVERED: { tone: 'success', label: 'Delivered', icon: CheckCheck },
  READ: { tone: 'success', label: 'Read', icon: ReadTicks },
  FAILED: { tone: 'danger', label: 'Failed', icon: XCircle },
  SKIPPED: { tone: 'neutral', label: 'Skipped', icon: SkipForward },
  // Lifecycle (templates, campaigns, flows)
  DRAFT: { tone: 'neutral', label: 'Draft', icon: FileEdit },
  PENDING: { tone: 'info', label: 'Pending', icon: Clock },
  APPROVED: { tone: 'success', label: 'Approved', icon: CheckCircle2 },
  REJECTED: { tone: 'danger', label: 'Rejected', icon: Ban },
  DISABLED: { tone: 'danger', label: 'Disabled', icon: XCircle },
  ARCHIVED: { tone: 'neutral', label: 'Archived', icon: Square },
  SCHEDULED: { tone: 'info', label: 'Scheduled', icon: Clock },
  PREPARING: { tone: 'info', label: 'Preparing', icon: Loader2 },
  PAUSED_INSUFFICIENT_FUNDS: { tone: 'warning', label: 'Paused: no credits', icon: Pause },
  PAUSED_TEMPLATE_UNAVAILABLE: {
    tone: 'warning',
    label: 'Paused: template unavailable',
    icon: Pause,
  },
  CANCELLED: { tone: 'neutral', label: 'Cancelled', icon: Ban },
  RUNNING: { tone: 'info', label: 'Running', icon: Zap },
  ACTIVE: { tone: 'success', label: 'Active', icon: Zap },
  PAUSED: { tone: 'warning', label: 'Paused', icon: Pause },
  STOPPED: { tone: 'neutral', label: 'Stopped', icon: Square },
  COMPLETED: { tone: 'success', label: 'Completed', icon: CheckCircle2 },
  // Automation executions and trigger runs (docs/AUTOMATION_ENGINE.md, P10-D2/D3)
  WAITING: { tone: 'info', label: 'Waiting', icon: Clock },
  STARTED: { tone: 'info', label: 'Started', icon: Zap },
  STOPPED_TAKEOVER: { tone: 'info', label: 'Stopped: takeover', icon: Hand },
  SKIPPED_TAKEOVER: { tone: 'neutral', label: 'Skipped: takeover', icon: Hand },
  SKIPPED_ENTITLEMENT: { tone: 'warning', label: 'Skipped: plan limit', icon: Ban },
  SUCCEEDED: { tone: 'success', label: 'Succeeded', icon: CheckCircle2 },
  // Conversations
  OPEN: { tone: 'info', label: 'Open', icon: Circle },
  RESOLVED: { tone: 'neutral', label: 'Resolved', icon: CheckCircle2 },
  SNOOZED: { tone: 'neutral', label: 'Snoozed', icon: Clock },
  AGENT_TAKEOVER: { tone: 'info', label: 'Agent takeover', icon: Hand },
  // Templates (Meta): paused by quality
  PAUSED_BY_META: { tone: 'warning', label: 'Paused by Meta', icon: Pause },
  // Consent (docs/CONTACTS_AND_CONSENT.md)
  GRANTED: { tone: 'success', label: 'Granted', icon: CheckCircle2 },
  NONE: { tone: 'neutral', label: 'Not recorded', icon: CircleDashed },
  OPTED_OUT: { tone: 'warning', label: 'Opted out', icon: Ban },
  // WhatsApp 24-hour service window
  WINDOW_OPEN: { tone: 'success', label: 'Window open', icon: Clock },
  WINDOW_CLOSED: { tone: 'warning', label: 'Window closed', icon: Clock },
  // Messaging eligibility (from MessageEligibilityService, read-only)
  CAN_SEND: { tone: 'success', label: 'Can send', icon: CheckCircle2 },
  CANNOT_SEND: { tone: 'warning', label: "Can't send", icon: Ban },
  // Health / attention
  HEALTHY: { tone: 'success', label: 'Healthy', icon: CheckCircle2 },
  ATTENTION: { tone: 'warning', label: 'Needs attention', icon: AlertTriangle },
  // Wallet (P11-D12): rendered from the backend state, never computed in the UI
  NORMAL: { tone: 'success', label: 'Funded', icon: CheckCircle2 },
  LOW_BALANCE: { tone: 'warning', label: 'Low balance', icon: AlertTriangle },
  INSUFFICIENT_FUNDS: { tone: 'danger', label: 'No credits', icon: Ban },
  NOT_ENFORCED: { tone: 'neutral', label: 'Not billed', icon: CircleDashed },
  INACTIVE: { tone: 'neutral', label: 'Inactive', icon: Square },
  SYNCING: { tone: 'info', label: 'Syncing', icon: Loader2 },
  PROCESSING: { tone: 'info', label: 'Processing', icon: Loader2 },
  // AI Assistant (docs/AI_ASSISTANT.md): knowledge sources, reply outcomes, inbox strip
  READY: { tone: 'success', label: 'Ready', icon: CheckCircle2 },
  REPLIED: { tone: 'success', label: 'Replied', icon: CheckCircle2 },
  NO_ANSWER: { tone: 'warning', label: 'No answer', icon: CircleDashed },
  HANDOFF: { tone: 'info', label: 'Handed to team', icon: Hand },
  QUOTA: { tone: 'warning', label: 'Quota reached', icon: Ban },
  AI_HANDLING: { tone: 'info', label: 'AI handling', icon: Sparkles },
  // Team
  DEACTIVATED: { tone: 'neutral', label: 'Deactivated', icon: Ban },
  EXPIRED: { tone: 'warning', label: 'Expired', icon: Clock },
  REVOKED: { tone: 'neutral', label: 'Revoked', icon: Ban },
  ACCEPTED: { tone: 'success', label: 'Accepted', icon: CheckCircle2 },
  // Health
  UP: { tone: 'success', label: 'Up', icon: CheckCircle2 },
  DOWN: { tone: 'danger', label: 'Down', icon: AlertTriangle },
  // Metric trends (MetricCard): the arrow carries direction, the tone whether it is good news.
  TREND_UP_POSITIVE: { tone: 'success', label: 'Up', icon: ArrowUpRight },
  TREND_UP_NEGATIVE: { tone: 'danger', label: 'Up', icon: ArrowUpRight },
  TREND_UP_NEUTRAL: { tone: 'neutral', label: 'Up', icon: ArrowUpRight },
  TREND_DOWN_POSITIVE: { tone: 'success', label: 'Down', icon: ArrowDownRight },
  TREND_DOWN_NEGATIVE: { tone: 'danger', label: 'Down', icon: ArrowDownRight },
  TREND_DOWN_NEUTRAL: { tone: 'neutral', label: 'Down', icon: ArrowDownRight },
  TREND_FLAT: { tone: 'neutral', label: 'No change', icon: Minus },
} as const satisfies Record<string, StatusPreset>

export type StatusKey = keyof typeof STATUS_PRESETS

export type StatusBadgeProps = {
  status: StatusKey
  /** Override the default label (e.g. "Delivered 2m ago"); the icon and tone stay. */
  label?: string
  className?: string
  /** Message metadata uses label/ticks without nesting an opaque pill in the bubble. */
  appearance?: 'default' | 'inline'
}

const inlineTones: Record<BadgeTone, string> = {
  neutral: 'text-secondary',
  primary: 'text-primary-strong',
  success: 'text-success-strong',
  warning: 'text-warning-strong',
  danger: 'text-danger-strong',
  info: 'text-info-strong',
}

export function StatusBadge({
  status,
  label,
  className,
  appearance = 'default',
}: StatusBadgeProps) {
  const preset: StatusPreset = STATUS_PRESETS[status]
  const Icon = preset.icon
  if (appearance === 'inline')
    return (
      <span
        data-slot="badge"
        data-status={status}
        className={cn(
          'inline-flex items-center gap-1 text-xs',
          inlineTones[preset.tone],
          className,
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {label ?? preset.label}
      </span>
    )
  return (
    <Badge tone={preset.tone} icon={<Icon />} className={className} data-status={status}>
      {label ?? preset.label}
    </Badge>
  )
}
