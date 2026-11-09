'use client'

import { Skeleton } from '@fenwira/ui'
import { Suspense } from 'react'
import { FollowUpsPage } from '@/components/follow-ups/follow-ups-page'

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <FollowUpsPage />
    </Suspense>
  )
}
