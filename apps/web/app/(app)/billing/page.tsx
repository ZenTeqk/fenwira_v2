import { redirect } from 'next/navigation'

export default function BillingIndex(): never {
  redirect('/billing/wallet')
}
