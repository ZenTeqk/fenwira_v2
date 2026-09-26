import { type StorageService } from './storage.service'

/** Magic bytes for the types we accept, so a renamed file can't pass as an image, video or PDF. */
const SIGNATURES: Array<{ mime: RegExp; test: (b: Buffer) => boolean }> = [
  { mime: /^image\/jpeg$/, test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: /^image\/png$/,
    test: (b) => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  },
  { mime: /^application\/pdf$/, test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: /^video\/(mp4|3gpp)$/, test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
]

/**
 * Checks a presigned upload landed as declared: the object exists, its size matches, and known
 * types carry the right magic bytes. Returns null while the upload hasn't finished.
 */
export async function verifyUpload(
  storage: StorageService,
  file: { bucket: string; objectKey: string; mimeType: string; sizeBytes: bigint | number },
): Promise<boolean | null> {
  const head = await storage.head(file.bucket, file.objectKey)
  if (!head) return null
  if (head.size !== Number(file.sizeBytes)) return false
  const signature = SIGNATURES.find((sig) => sig.mime.test(file.mimeType))
  return signature
    ? signature.test(await storage.getBytes(file.bucket, file.objectKey, 'bytes=0-15'))
    : true
}
