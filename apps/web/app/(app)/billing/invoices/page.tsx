'use client'

import { Suspense } from 'react'
import { InvoicesView } from '@/components/billing/invoices-view'

export default function InvoicesPage() {
  return (
    <Suspense>
      <InvoicesView />
    </Suspense>
  )
}
