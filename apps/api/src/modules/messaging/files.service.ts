import { type FileDto, MEDIA_LIMITS, type UploadUrlRequest } from '@fenwira/contracts'
import { uuidv7 } from '@fenwira/config'
import { Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { StorageService } from '../../core/storage/storage.service'
import { verifyUpload } from '../../core/storage/uploads'
import { currentActorId, currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import { conversationVisibility } from './visibility'

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

  /**
   * A server-side upload (POST /graph/{id}/media, docs/API_KEYS.md → Meta-compatible send): the
   * same checks as a presigned upload — accepted type, Meta's size limit, magic bytes — then READY.
   */
  async store(input: { bytes: Buffer; mimeType: string; filename?: string }): Promise<FileDto> {
    const { tenantId } = currentTenant()
    const limit = Object.values(MEDIA_LIMITS).find((l) => l.mime.test(input.mimeType))
    if (!limit)
      throw AppError.validation([
        { path: 'type', code: 'unsupported', message: 'WhatsApp does not accept this file type.' },
      ])
    if (input.bytes.length > limit.max)
      throw AppError.validation([
        { path: 'file', code: 'too_large', message: 'This file is larger than WhatsApp allows.' },
      ])
    const id = uuidv7()
    const file = {
      id,
      tenantId,
      bucket: this.storage.mediaBucket,
      objectKey: `${tenantId}/media/${id}`,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.length,
      filename: input.filename ?? null,
      purpose: 'MESSAGE_MEDIA' as const,
      uploadedBy: currentActorId(),
    }
    await this.tenantDb.run((tx) => tx.file.create({ data: file }))
    await this.storage.put(file.bucket, file.objectKey, input.bytes, input.mimeType)
    const ok = await verifyUpload(this.storage, file)
    const updated = await this.tenantDb.run((tx) =>
      tx.file.update({ where: { id }, data: { status: ok ? 'READY' : 'REJECTED' } }),
    )
    if (!ok)
      throw AppError.validation([
        { path: 'file', code: 'invalid', message: "The file content doesn't match its type." },
      ])
    return toFile(updated)
  }

  /**
   * A short-lived link to a message attachment (docs/INBOX.md → Attachments). This route serves
   * message attachments only:
   * - MESSAGE_MEDIA, and a TEMPLATE_SAMPLE used as a sent template's media header, need a message
   *   in a conversation this user can see (conversationVisibility, as the list and thread);
   * - MESSAGE_MEDIA the user uploaded and hasn't sent yet stays visible to that uploader.
   * Other files have their own routes and permissions: IMPORT (import error reports,
   * contacts.import), EXPORT (contacts.export), TEMPLATE_SAMPLE (templates.read), PAYMENT_PROOF
   * (platform operator). AVATAR is unused. Any other case is the same 404 as a missing file, so
   * ids can't be probed.
   */
  async downloadUrl(id: string): Promise<{ url: string; expiresAt: string }> {
    const { userId } = currentAuth()
    const file = await this.tenantDb.run(async (tx) => {
      const visible = await conversationVisibility(tx, userId)
      return tx.file.findFirst({
        where: {
          id,
          status: 'READY',
          OR: [
            {
              purpose: { in: ['MESSAGE_MEDIA', 'TEMPLATE_SAMPLE'] },
              messages: { some: { conversation: visible } },
            },
            { purpose: 'MESSAGE_MEDIA', uploadedBy: userId, messages: { none: {} } },
          ],
        },
      })
    })
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
