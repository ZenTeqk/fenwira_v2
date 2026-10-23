'use client'

import { Button, Input, toast } from '@fenwira/ui'
import { Copy } from 'lucide-react'

/**
 * A one-time link to hand over by chat or phone (ADR-0027 step 4: works without email). It is
 * shown once: Fenwira stores only its hash, so a lost link means issuing a new one.
 */
export function CopyLink({
  link,
  expiresAt,
  label,
}: {
  link: string
  expiresAt?: string | null
  label: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input readOnly value={link} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            void navigator.clipboard.writeText(link).then(() => toast.success('Link copied'))
          }
        >
          <Copy aria-hidden="true" />
          Copy
        </Button>
      </div>
      <p className="text-sm text-secondary">
        Works once
        {expiresAt ? `, until ${new Date(expiresAt).toLocaleString()}` : ''}. It won’t be shown
        again.
      </p>
    </div>
  )
}
