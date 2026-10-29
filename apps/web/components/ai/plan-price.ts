import { type AiPlan } from '@fenwira/contracts'

export function formatPlanPrice(plan: Pick<AiPlan, 'monthlyPriceMinor' | 'currency'>) {
  const format = new Intl.NumberFormat('en-IN', { style: 'currency', currency: plan.currency })
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2
  return `${format.format(plan.monthlyPriceMinor / 10 ** digits)} / month`
}
