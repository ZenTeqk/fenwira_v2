import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { type Readable } from 'node:stream'
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common'
import { CORE_CONFIG, type CoreConfig, type StorageConfig } from '../config/core-config'

export type { StorageConfig } from '../config/core-config'

/** S3/MinIO settings shared by the api and worker envs. */
export function storageConfigFromEnv(env: {
  S3_ENDPOINT: string
  S3_PUBLIC_ENDPOINT?: string
  S3_REGION: string
  S3_ACCESS_KEY_ID?: string
  S3_SECRET_ACCESS_KEY?: string
  S3_FORCE_PATH_STYLE: boolean
  S3_BUCKET_MEDIA: string
  S3_BUCKET_IMPORTS: string
  S3_BUCKET_EXPORTS: string
}): StorageConfig {
  return {
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    mediaBucket: env.S3_BUCKET_MEDIA,
    importsBucket: env.S3_BUCKET_IMPORTS,
    exportsBucket: env.S3_BUCKET_EXPORTS,
  }
}

/**
 * MinIO/S3 access (docs/ARCHITECTURE.md → Files). Server-side calls use the internal endpoint;
 * presigned URLs are signed for the public endpoint browsers can reach.
 */
@Injectable()
export class StorageService implements OnApplicationShutdown {
  private readonly internal: S3Client
  private readonly publicClient: S3Client
  readonly mediaBucket: string
  readonly importsBucket: string
  readonly exportsBucket: string

  constructor(@Inject(CORE_CONFIG) config: CoreConfig) {
    const s = config.storage
    if (!s) throw new Error('StorageService needs CoreConfig.storage')
    const base = {
      region: s.region,
      forcePathStyle: s.forcePathStyle,
      // No static keys = the SDK default credential chain (EC2 instance role on AWS).
      ...(s.accessKeyId && s.secretAccessKey
        ? { credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey } }
        : {}),
    }
    this.internal = new S3Client({ ...base, endpoint: s.endpoint })
    this.publicClient = new S3Client({ ...base, endpoint: s.publicEndpoint ?? s.endpoint })
    this.mediaBucket = s.mediaBucket
    this.importsBucket = s.importsBucket
    this.exportsBucket = s.exportsBucket
  }

  presignPut(
    bucket: string,
    key: string,
    contentType: string,
    contentLength: number,
    expiresIn = 900,
  ) {
    return getSignedUrl(
      this.publicClient,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) },
    )
  }

  presignGet(bucket: string, key: string, expiresIn = 300, filename?: string) {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(filename
          ? { ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"` }
          : {}),
      }),
      { expiresIn },
    )
  }

  /** Size and type of an object, or null when it doesn't exist. */
  async head(bucket: string, key: string): Promise<{ size: number; contentType?: string } | null> {
    try {
      const res = await this.internal.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      return { size: Number(res.ContentLength ?? 0), contentType: res.ContentType }
    } catch (err) {
      if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
        return null
      throw err
    }
  }

  async getBytes(bucket: string, key: string, range?: string): Promise<Buffer> {
    const res = await this.internal.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, ...(range ? { Range: range } : {}) }),
    )
    return Buffer.from(await res.Body!.transformToByteArray())
  }

  /** Streams an object (large CSV imports) instead of buffering it. */
  async getStream(bucket: string, key: string): Promise<Readable> {
    const res = await this.internal.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    return res.Body as Readable
  }

  async put(bucket: string, key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.internal.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }),
    )
  }

  onApplicationShutdown(): void {
    this.internal.destroy()
    this.publicClient.destroy()
  }
}
