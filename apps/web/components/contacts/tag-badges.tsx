import { type Tag } from '@fenwira/contracts'
import { Badge } from '@fenwira/ui'
import { TAG_TONE } from '@/lib/contacts'

export function TagBadges({ tags, max = 3 }: { tags: Tag[]; max?: number }) {
  if (!tags.length) return <span className="text-muted">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {tags.slice(0, max).map((t) => (
        <Badge key={t.id} tone={TAG_TONE[t.color]}>
          {t.name}
        </Badge>
      ))}
      {tags.length > max ? <Badge tone="neutral">+{tags.length - max}</Badge> : null}
    </span>
  )
}
