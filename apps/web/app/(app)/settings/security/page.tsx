'use client'

import { PageHeader } from '@fenwira/ui'
import { PasswordCard, ProfileCard } from '@/components/security/account-cards'
import { ActivityCard, SessionsCard } from '@/components/security/sessions-card'
import { TwoFactorCard } from '@/components/security/two-factor-card'

/** Personal account security (PRD SE-1, AU-2). Not tenant-scoped. */
export default function SecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security"
        description="Your profile, password, two-factor authentication and sessions."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileCard />
        <PasswordCard />
      </div>
      <TwoFactorCard />
      <SessionsCard />
      <ActivityCard />
    </div>
  )
}
