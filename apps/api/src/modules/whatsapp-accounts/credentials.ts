import { decryptSecret, type KeyRing } from '@fenwira/config'
import { type TenantTx } from '@fenwira/database'
import { emitConnectionChanged } from './graph-support'

/**
 * Credential access for other modules (messaging). The decrypted token is returned to the caller
 * only to be passed straight to a Graph call; it must never be stored, logged or returned.
 */
export async function loadLiveToken(
  tx: TenantTx,
  keyRing: KeyRing,
  wabaRowId: string,
): Promise<{ credentialId: string; token: string } | null> {
  const credential = await tx.metaCredential.findFirst({
    where: { wabaId: wabaRowId, status: { in: ['VALID', 'EXPIRING'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (!credential?.tokenCiphertext) return null
  return { credentialId: credential.id, token: decryptSecret(keyRing, credential.tokenCiphertext) }
}

/** Meta rejected the token (190 / permission): stop using it until it is rotated. */
export async function markCredentialInvalid(
  tx: TenantTx,
  tenantId: string,
  credentialId: string,
  phoneId: string,
): Promise<void> {
  await tx.metaCredential.update({
    where: { id: credentialId },
    data: { status: 'INVALID', lastCheckedAt: new Date() },
  })
  await emitConnectionChanged(tx, tenantId, phoneId, 'CREDENTIAL_CHANGED')
}
