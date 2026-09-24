/**
 * Meta Graph error classification (docs/META_INTEGRATION.md → Error classification).
 * Every Graph failure becomes a GraphError whose `classification` decides what callers do:
 * retry with backoff, back off harder, mark the credential invalid, or fail permanently.
 */
export type ErrorClass = 'RETRYABLE' | 'RETRYABLE_RATE' | 'CREDENTIAL' | 'PERMANENT'

export type ClassifiedError = {
  classification: ErrorClass
  /** Fenwira's own code for the UI/logs (never includes request data). */
  fenwiraCode: string
  title: string
}

const TABLE: Array<{ codes: number[]; result: ClassifiedError }> = [
  {
    codes: [1, 2, 131000],
    result: {
      classification: 'RETRYABLE',
      fenwiraCode: 'META_TRANSIENT',
      title: 'Temporary Meta error',
    },
  },
  {
    codes: [4, 80007, 130429],
    result: {
      classification: 'RETRYABLE_RATE',
      fenwiraCode: 'META_RATE_LIMITED',
      title: 'Meta rate limit reached',
    },
  },
  {
    codes: [131056],
    result: {
      classification: 'RETRYABLE_RATE',
      fenwiraCode: 'META_PAIR_RATE_LIMITED',
      title: 'Too many messages to this recipient',
    },
  },
  {
    codes: [131048],
    result: {
      classification: 'RETRYABLE_RATE',
      fenwiraCode: 'META_SPAM_RATE_LIMITED',
      title: 'Spam rate limit reached',
    },
  },
  {
    codes: [190],
    result: {
      classification: 'CREDENTIAL',
      fenwiraCode: 'META_TOKEN_INVALID',
      title: 'Access token expired or invalid',
    },
  },
  {
    codes: [10, 200, 299],
    result: {
      classification: 'CREDENTIAL',
      fenwiraCode: 'META_PERMISSION_DENIED',
      title: 'Missing Meta permission',
    },
  },
  {
    codes: [131047],
    result: {
      classification: 'PERMANENT',
      fenwiraCode: 'CONVERSATION_WINDOW_CLOSED',
      title: 'Re-engagement required (24-hour window closed)',
    },
  },
  {
    codes: [131026],
    result: {
      classification: 'PERMANENT',
      fenwiraCode: 'META_UNDELIVERABLE',
      title: 'Message undeliverable',
    },
  },
  {
    codes: [131049],
    result: {
      classification: 'PERMANENT',
      fenwiraCode: 'META_ECOSYSTEM_LIMIT',
      title: 'Not delivered to protect the ecosystem',
    },
  },
  {
    codes: [131050],
    result: {
      classification: 'PERMANENT',
      fenwiraCode: 'META_USER_OPTED_OUT',
      title: 'User stopped marketing messages',
    },
  },
  {
    codes: [131051, 131052, 131053],
    result: {
      classification: 'PERMANENT',
      fenwiraCode: 'META_MEDIA_ERROR',
      title: 'Unsupported message type or media error',
    },
  },
  {
    codes: [132000, 132001, 132005, 132007, 132012, 132015, 132016],
    result: {
      classification: 'PERMANENT',
      fenwiraCode: 'META_TEMPLATE_ERROR',
      title: 'Template problem',
    },
  },
  {
    codes: [131031],
    result: {
      classification: 'PERMANENT',
      fenwiraCode: 'META_ACCOUNT_LOCKED',
      title: 'Business account locked',
    },
  },
  {
    codes: [368],
    result: {
      classification: 'PERMANENT',
      fenwiraCode: 'META_TEMPORARILY_BLOCKED',
      title: 'Temporarily blocked for policy violations',
    },
  },
  {
    codes: [100],
    result: {
      classification: 'PERMANENT',
      fenwiraCode: 'META_INVALID_PARAMETER',
      title: 'Invalid parameter',
    },
  },
]

const BY_CODE = new Map<number, ClassifiedError>(
  TABLE.flatMap(({ codes, result }) => codes.map((c) => [c, result] as const)),
)

/** Network errors, timeouts and HTTP 5xx are retryable; unknown codes are retried a little, then fail. */
export function classifyMetaError(
  code: number | undefined,
  httpStatus: number | undefined,
): ClassifiedError {
  if (code !== undefined && BY_CODE.has(code)) return BY_CODE.get(code)!
  if (httpStatus === undefined || httpStatus === 0 || httpStatus >= 500) {
    return {
      classification: 'RETRYABLE',
      fenwiraCode: 'META_UNAVAILABLE',
      title: 'Meta is unavailable',
    }
  }
  return {
    classification: 'RETRYABLE',
    fenwiraCode: 'META_UNKNOWN_ERROR',
    title: 'Unexpected Meta error',
  }
}

/** A Graph API failure. `message` is Meta's text, which never contains our tokens or message bodies. */
export class GraphError extends Error {
  readonly classification: ErrorClass
  readonly fenwiraCode: string
  readonly title: string

  constructor(
    message: string,
    readonly httpStatus: number | undefined,
    readonly code: number | undefined,
    readonly subcode?: number,
    readonly fbtraceId?: string,
  ) {
    super(message)
    this.name = 'GraphError'
    const c = classifyMetaError(code, httpStatus)
    this.classification = c.classification
    this.fenwiraCode = c.fenwiraCode
    this.title = c.title
  }

  get retryable(): boolean {
    return this.classification === 'RETRYABLE' || this.classification === 'RETRYABLE_RATE'
  }
}
