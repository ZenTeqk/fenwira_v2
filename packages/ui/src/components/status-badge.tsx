import {
  AlertTriangle,
  Ban,
  CheckCheck,
  CheckCircle2,
  Circle,
  CircleDashed,
  Clock,
  FileEdit,
  Hand,
  Loader2,
  type LucideIcon,
  Pause,
  PlugZap,
  Send,
  SkipForward,
  Square,
  XCircle,
  Zap,
} from 'lucide-react'
import { Badge, type BadgeTone } from './badge'

type StatusPreset = { tone: BadgeTone; label: string; icon: LucideIcon }

/**
 * The single mapping from domain status to tone, label and icon. Feature code passes a status;
 * it never picks a color (docs/DESIGN_SYSTEM.md → Core components).
 */
export const STATUS_PRESETS = {
  // Connections
  CONNECTED: { tone: 'success', label: 'Connected', icon: CheckCircle2 },
  DISCONNECTED: { tone: 'neutral', label: 'Disconnected', icon: PlugZap },
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
  SENT: { tone: 'primary', label: 'Sent', icon: Send },
  DELIVERED: { tone: 'success', label: 'Delivered', icon: CheckCheck },
  READ: { tone: 'success', label: 'Read', icon: CheckCheck },
  FAILED: { tone: 'danger', label: 'Failed', icon: XCircle },
  SKIPPED: { tone: 'neutral', label: 'Skipped', icon: SkipForward },
  // Lifecycle (templates, campaigns, flows)
  DRAFT: { tone: 'neutral', label: 'Draft', icon: FileEdit },
  PENDING: { tone: 'warning', label: 'Pending', icon: Clock },
  APPROVED: { tone: 'success', label: 'Approved', icon: CheckCircle2 },
  REJECTED: { tone: 'danger', label: 'Rejected', icon: Ban },
  DISABLED: { tone: 'danger', label: 'Disabled', icon: XCircle },
  ARCHIVED: { tone: 'neutral', label: 'Archived', icon: Square },
  SCHEDULED: { tone: 'info', label: 'Scheduled', icon: Clock },
  PREPARING: { tone: 'info', label: 'Preparing', icon: Loader2 },
  PAUSED_INSUFFICIENT_FUNDS: { tone: 'danger', label: 'Paused: no credits', icon: Pause },
  CANCELLED: { tone: 'neutral', label: 'Cancelled', icon: Ban },
  RUNNING: { tone: 'primary', label: 'Running', icon: Zap },
  ACTIVE: { tone: 'success', label: 'Active', icon: Zap },
  PAUSED: { tone: 'warning', label: 'Paused', icon: Pause },
  STOPPED: { tone: 'neutral', label: 'Stopped', icon: Square },
  COMPLETED: { tone: 'success', label: 'Completed', icon: CheckCircle2 },
  // Conversations
  OPEN: { tone: 'primary', label: 'Open', icon: Circle },
  RESOLVED: { tone: 'neutral', label: 'Resolved', icon: CheckCircle2 },
  SNOOZED: { tone: 'neutral', label: 'Snoozed', icon: Clock },
  AGENT_TAKEOVER: { tone: 'info', label: 'Agent takeover', icon: Hand },
  // Team
  DEACTIVATED: { tone: 'neutral', label: 'Deactivated', icon: Ban },
  EXPIRED: { tone: 'warning', label: 'Expired', icon: Clock },
  REVOKED: { tone: 'neutral', label: 'Revoked', icon: Ban },
  ACCEPTED: { tone: 'success', label: 'Accepted', icon: CheckCircle2 },
  // Health
  UP: { tone: 'success', label: 'Up', icon: CheckCircle2 },
  DOWN: { tone: 'danger', label: 'Down', icon: AlertTriangle },
} as const satisfies Record<string, StatusPreset>

export type StatusKey = keyof typeof STATUS_PRESETS

export type StatusBadgeProps = {
  status: StatusKey
  /** Override the default label (e.g. "Delivered 2m ago"); the icon and tone stay. */
  label?: string
  className?: string
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const preset: StatusPreset = STATUS_PRESETS[status]
  const Icon = preset.icon
  return (
    <Badge tone={preset.tone} icon={<Icon />} className={className} data-status={status}>
      {label ?? preset.label}
    </Badge>
  )
}
