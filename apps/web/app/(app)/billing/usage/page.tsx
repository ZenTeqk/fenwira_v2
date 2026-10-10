import { redirect } from 'next/navigation'

/** Billing and Analytics share the existing customer-charge Usage view. */
export default function BillingUsage(): never {
  redirect('/analytics/usage')
}
