import { type FileDto, MEDIA_LIMITS, type UploadUrlRequest } from '@fenwira/contracts'
import { uuidv7 } from '@fenwira/config'
import { Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { StorageService } from '../../core/storage/storage.service'
import { verifyUpload } from '../../core/storage/uploads'
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
    const file = await this.tenantDb.run((tx) =>
      tx.file.findFirst({ where: { id, purpose: 'MESSAGE_MEDIA' } }),
    )
    if (!file) throw AppError.notFound('File not found.')
    if (file.status !== 'PENDING_UPLOAD') return toFile(file)
    const ok = await verifyUpload(this.storage, file)
    if (ok === null) throw new AppError('FILE_NOT_READY', 422, 'The upload has not finished yet.')
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
