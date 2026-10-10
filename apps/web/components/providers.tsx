'use client'

import { ConfirmProvider, Toaster, TooltipProvider } from '@fenwira/ui'
import { type ReactNode } from 'react'
import { QueryProvider } from './session/session-provider'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <TooltipProvider delayDuration={300}>
        <ConfirmProvider>
          {children}
          <Toaster />
        </ConfirmProvider>
      </TooltipProvider>
    </QueryProvider>
  )
}
