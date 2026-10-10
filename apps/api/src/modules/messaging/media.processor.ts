import { sha256, uuidv7 } from '@fenwira/config'
import { type MessageContent } from '@fenwira/contracts'
import { Database, type Prisma } from '@fenwira/database'
import { QUEUES } from '@fenwira/queue'
import { GraphClient } from '@fenwira/whatsapp'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { StorageService } from '../../core/storage/storage.service'
import { loadLiveToken } from '../whatsapp-accounts'
import { toMessage } from './messaging.mapper'
import { MESSAGING_OPTIONS, type MessagingOptions } from './messaging.options'

type MediaJob = { tenantId: string; messageId: string }

/**
 * whatsapp.media: copies inbound media from Meta (short-lived URL, bearer token) into MinIO as a
 * READY `files` row and links it to the message. Meta keeps media for a limited time only, so
 * this runs right after the message is stored.
 */
@Injectable()
export class MediaProcessor implements QueueProcessor<MediaJob> {
  readonly queue = QUEUES.whatsappMedia
  readonly concurrency = 5
  private readonly graph: GraphClient

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(MESSAGING_OPTIONS) private readonly options: MessagingOptions,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeEmitter,
  ) {
    this.graph = new GraphClient({
      baseUrl: options.graphBaseUrl,
      version: options.graphVersion,
      timeoutMs: 60_000,
    })
  }

  async process(job: Job<MediaJob>): Promise<string> {
    const { tenantId, messageId } = job.data
    const loaded = await this.db.withTenant(tenantId, async (tx) => {
      const message = await tx.message.findFirst({
        where: { id: messageId },
        include: { conversation: { include: { phoneNumber: true } } },
      })
      const content = message?.content as { mediaId?: string } | undefined
      if (!message || message.fileId || !content?.mediaId) return null
      const credential = await loadLiveToken(
        tx,
        this.options.keyRing,
        message.conversation.phoneNumber.wabaId,
      )
      return credential ? { message, mediaId: content.mediaId, token: credential.token } : null
    })
    if (!loaded) return 'skipped'

    const meta = await this.graph.getMediaUrl(loaded.token, loaded.mediaId)
    const { bytes, mimeType } = await this.graph.downloadMedia(loaded.token, meta.url)
    const fileId = uuidv7()
    const objectKey = `${tenantId}/media/${fileId}`
    const type = meta.mime_type ?? mimeType ?? 'application/octet-stream'
    await this.storage.put(this.storage.mediaBucket, objectKey, bytes, type)

    const updated = await this.db.withTenant(tenantId, async (tx) => {
      const content = loaded.message.content as MessageContent & { filename?: string }
      await tx.file.create({
        data: {
          id: fileId,
          tenantId,
          bucket: this.storage.mediaBucket,
          objectKey,
          mimeType: type,
          sizeBytes: bytes.length,
          filename: content.filename ?? null,
          sha256: sha256(bytes),
          purpose: 'MESSAGE_MEDIA',
          status: 'READY',
        },
      })
      return tx.message.update({
        where: { id: messageId },
        data: { fileId, content: { ...content, fileId } as Prisma.InputJsonValue },
      })
    })
    this.realtime.toConversation(
      tenantId,
      updated.conversationId,
      'message.updated',
      toMessage(updated),
    )
    return 'stored'
  }
}
