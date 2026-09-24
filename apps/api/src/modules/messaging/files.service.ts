import { type FileDto, MEDIA_LIMITS, type UploadUrlRequest } from '@fenwira/contracts'
import { uuidv7 } from '@fenwira/config'
import { Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { StorageService } from '../../core/storage/storage.service'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'

const toFile = (f: {
  id: string
  mimeType: string
  sizeBytes: bigint
  status: FileDto['status']
  createdAt: Date
}): FileDto => ({
  id: f.id,
  mimeType: f.mimeType,
  sizeBytes: Number(f.sizeBytes),
  status: f.status,
  createdAt: f.createdAt.toISOString(),
})

/** Magic bytes for the types we accept, so a renamed file can't pass as an image or PDF. */
const SIGNATURES: Array<{ mime: RegExp; test: (b: Buffer) => boolean }> = [
  { mime: /^image\/jpeg$/, test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: /^image\/png$/,
    test: (b) => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  },
  { mime: /^application\/pdf$/, test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: /^video\/(mp4|3gpp)$/, test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
]

const acceptedMime = (mime: string) => Object.values(MEDIA_LIMITS).some((l) => l.mime.test(mime))

/**
 * Message media via presigned URLs (docs/API_SPEC.md → Files): the browser PUTs straight to
 * MinIO/S3, then `complete` checks size and content before the file becomes READY.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly storage: StorageService,
  ) {}

  async createUpload(input: UploadUrlRequest) {
    const { tenantId } = currentTenant()
    if (!acceptedMime(input.mimeType))
      throw AppError.validation([
        {
          path: 'mimeType',
          code: 'unsupported',
          message: 'WhatsApp does not accept this file type.',
        },
      ])
    const id = uuidv7()
    const objectKey = `${tenantId}/media/${id}`
    await this.tenantDb.run((tx) =>
      tx.file.create({
        data: {
          id,
          tenantId,
          bucket: this.storage.mediaBucket,
          objectKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          filename: input.filename ?? null,
          purpose: 'MESSAGE_MEDIA',
          uploadedBy: currentAuth().userId,
        },
      }),
    )
    const expiresIn = 900
    const url = await this.storage.presignPut(
      this.storage.mediaBucket,
      objectKey,
      input.mimeType,
      input.sizeBytes,
      expiresIn,
    )
    return {
      fileId: id,
      url,
      headers: { 'Content-Type': input.mimeType },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    }
  }

  async complete(id: string): Promise<FileDto> {
    const file = await this.tenantDb.run((tx) => tx.file.findFirst({ where: { id } }))
    if (!file) throw AppError.notFound('File not found.')
    if (file.status !== 'PENDING_UPLOAD') return toFile(file)
    const head = await this.storage.head(file.bucket, file.objectKey)
    if (!head) throw new AppError('FILE_NOT_READY', 422, 'The upload has not finished yet.')
    let ok = head.size === Number(file.sizeBytes)
    const signature = SIGNATURES.find((s) => s.mime.test(file.mimeType))
    if (ok && signature)
      ok = signature.test(await this.storage.getBytes(file.bucket, file.objectKey, 'bytes=0-15'))
    const updated = await this.tenantDb.run((tx) =>
      tx.file.update({ where: { id }, data: { status: ok ? 'READY' : 'REJECTED' } }),
    )
    return toFile(updated)
  }

  async downloadUrl(id: string): Promise<{ url: string; expiresAt: string }> {
    const file = await this.tenantDb.run((tx) =>
      tx.file.findFirst({ where: { id, purpose: 'MESSAGE_MEDIA', status: 'READY' } }),
    )
    if (!file) throw AppError.notFound('File not found.')
    const expiresIn = 300
    return {
      url: await this.storage.presignGet(
        file.bucket,
        file.objectKey,
        expiresIn,
        file.filename ?? undefined,
      ),
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    }
  }
}
