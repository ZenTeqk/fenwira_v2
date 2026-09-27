import { type ConsentState } from '@fenwira/contracts'
import { StatusBadge, type StatusKey } from '@fenwira/ui'
import { CONSENT_LABEL } from '@/lib/contacts'

const STATUS: Record<ConsentState, StatusKey> = {
  GRANTED: 'GRANTED',
  REVOKED: 'OPTED_OUT',
  NONE: 'NONE',
}

/** Consent as a status (label + icon), never a hand-picked tone. */
export function ConsentBadge({ state }: { state: ConsentState }) {
  return <StatusBadge status={STATUS[state]} label={CONSENT_LABEL[state]} />
}
