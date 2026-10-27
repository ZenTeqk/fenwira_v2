'use client'

import { Skeleton } from '@fenwira/ui'
import { Suspense } from 'react'
import { InboxLayout } from '@/components/inbox/inbox-layout'

export default function InboxPage() {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-64" />}>
      <InboxLayout />
    </Suspense>
  )
}
