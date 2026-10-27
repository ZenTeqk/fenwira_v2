import { z } from 'zod'
import {
  AUTH_BODY_TEXT,
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
  type TemplateComponents,
  type TemplateVariables,
  templateVariablesSchema,
} from './components'

/**
 * What a template message looked like when it was sent (docs/MESSAGING_ENGINE.md → Template
 * snapshot): header, body with the variables substituted, footer and buttons. Written once at send
 * time (and by the backfill for older messages), so the inbox shows the real content even after
 * the template is edited, re-approved or deleted.
 */
export const SNAPSHOT_HEADER_MEDIA = ['IMAGE', 'VIDEO', 'DOCUMENT'] as const
export type SnapshotHeaderMedia = (typeof SNAPSHOT_HEADER_MEDIA)[number]

export const templateSnapshotButtonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('QUICK_REPLY'), label: z.string() }),
  z.object({ type: z.literal('URL'), label: z.string(), url: z.string() }),
  z.object({ type: z.literal('PHONE_NUMBER'), label: z.string(), phoneE164: z.string() }),
  z.object({ type: z.literal('COPY_CODE'), label: z.string(), code: z.string() }),
])
export type TemplateSnapshotButton = z.infer<typeof templateSnapshotButtonSchema>

export const templateSnapshotHeaderSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), text: z.string() }),
  z.object({
    type: z.enum(SNAPSHOT_HEADER_MEDIA),
    /** Our stored file (messages.file_id); null when it can't be resolved any more. */
    fileId: z.string().nullable(),
    filename: z.string().nullable(),
    mimeType: z.string().nullable(),
  }),
])
export type TemplateSnapshotHeader = z.infer<typeof templateSnapshotHeaderSchema>

export const messageTemplateSnapshotSchema = z.object({
  v: z.literal(1),
  name: z.string(),
  language: z.string(),
  category: z.enum(TEMPLATE_CATEGORIES).nullable(),
  header: templateSnapshotHeaderSchema.nullable(),
  /** Body with the variables substituted; null only when the template is gone. */
  body: z.string().nullable(),
  footer: z.string().nullable(),
  buttons: z.array(templateSnapshotButtonSchema),
  /** The raw values that were sent. */
  variables: templateVariablesSchema,
  /** Something could not be resolved (template deleted, a value missing). */
  partial: z.boolean(),
  /** What is missing: `template`, `body.2`, `header.file`, … */
  missing: z.array(z.string()),
})
export type MessageTemplateSnapshot = z.infer<typeof messageTemplateSnapshotSchema>

export type HeaderFile = { id: string; filename: string | null; mimeType: string | null }

const VARIABLE_RE = /\{\{\s*(\d+)\s*\}\}/g
/** Substitutes positional values; a missing value keeps `{{n}}` and is reported. */
function fill(
  text: string,
  values: readonly (string | undefined)[] | undefined,
  path: string,
  missing: string[],
): string {
  return text.replace(VARIABLE_RE, (whole, n: string) => {
    const value = values?.[Number(n) - 1]
    if (value?.trim()) return value
    missing.push(`${path}.${Number(n) - 1}`)
    return whole
  })
}

/**
 * Renders the snapshot from the template version's components and the values that were sent.
 * `components: null` means the template can no longer be resolved: the snapshot keeps the name,
 * language and values and is marked partial. Pure, so sends and the backfill render identically.
 */
export function renderTemplateSnapshot(input: {
  name: string
  language: string
  category: TemplateCategory | null
  components: TemplateComponents | null
  values: TemplateVariables | undefined
  headerFile?: HeaderFile | null
}): MessageTemplateSnapshot {
  const values: TemplateVariables = input.values ?? { body: [] }
  const missing: string[] = []
  const base = {
    v: 1 as const,
    name: input.name,
    language: input.language,
    category: input.category,
    variables: values,
  }
  const c = input.components
  if (!c) {
    const media = input.headerFile ? mediaHeader(input.headerFile.mimeType, input.headerFile) : null
    return {
      ...base,
      header: media,
      body: null,
      footer: null,
      buttons: [],
      partial: true,
      missing: ['template'],
    }
  }

  let header: TemplateSnapshotHeader | null = null
  if (c.header?.format === 'TEXT')
    header = { type: 'TEXT', text: fill(c.header.text, values.header, 'header', missing) }
  else if (c.header) {
    const file = input.headerFile ?? null
    if (!file) missing.push('header.file')
    header = {
      type: c.header.format,
      fileId: file?.id ?? null,
      filename: file?.filename ?? null,
      mimeType: file?.mimeType ?? null,
    }
  }

  // Authentication: Meta renders a fixed body around the code, plus optional security and
  // expiry lines, and a single copy-code button carrying the same code.
  if (input.category === 'AUTHENTICATION') {
    const code = values.body[0]?.trim() ? values.body[0] : undefined
    if (!code) missing.push('body.0')
    const body =
      fill(AUTH_BODY_TEXT, values.body, 'body', []) +
      (c.auth?.securityRecommendation ? ' For your security, do not share this code.' : '')
    return {
      ...base,
      header: null,
      body,
      footer: c.auth?.codeExpirationMinutes
        ? `This code expires in ${c.auth.codeExpirationMinutes} minutes.`
        : (c.footer?.text ?? null),
      buttons: [{ type: 'COPY_CODE', label: 'Copy code', code: code ?? '' }],
      partial: missing.length > 0,
      missing,
    }
  }

  const body = fill(c.body.text, values.body, 'body', missing)
  const buttons: TemplateSnapshotButton[] = (c.buttons ?? []).map((b, i) => {
    const own = values.buttons?.[String(i)]
    switch (b.type) {
      case 'QUICK_REPLY':
        return { type: 'QUICK_REPLY', label: b.text }
      case 'URL':
        return {
          type: 'URL',
          label: b.text,
          url: fill(b.url, own, `buttons.${i}`, missing),
        }
      case 'PHONE_NUMBER':
        return { type: 'PHONE_NUMBER', label: b.text, phoneE164: b.phoneE164 }
      case 'COPY_CODE':
        return { type: 'COPY_CODE', label: 'Copy code', code: own?.[0] || b.example }
    }
  })
  return {
    ...base,
    header,
    body,
    footer: c.footer?.text ?? null,
    buttons,
    partial: missing.length > 0,
    missing,
  }
}

function mediaHeader(mimeType: string | null, file: HeaderFile): TemplateSnapshotHeader | null {
  const type = mimeType?.startsWith('image/')
    ? 'IMAGE'
    : mimeType?.startsWith('video/')
      ? 'VIDEO'
      : mimeType
        ? 'DOCUMENT'
        : null
  return type ? { type, fileId: file.id, filename: file.filename, mimeType: file.mimeType } : null
}

type MetaParam = { type?: string; text?: string; coupon_code?: string }
type MetaComponent = {
  type?: string
  sub_type?: string
  index?: string | number
  parameters?: MetaParam[]
}

/**
 * Raw values back out of Meta send components (sends by name with raw `components`, and the
 * backfill for messages stored without `variables`). Media parameters are skipped: the header file
 * is tracked through `messages.file_id`.
 */
export function variablesFromMetaComponents(
  raw: readonly unknown[] | undefined,
): TemplateVariables {
  const out: TemplateVariables = { body: [] }
  for (const item of raw ?? []) {
    if (!item || typeof item !== 'object') continue
    const comp = item as MetaComponent
    const texts = (comp.parameters ?? []).map((p) =>
      p.type === 'coupon_code' ? (p.coupon_code ?? '') : p.type === 'text' ? (p.text ?? '') : null,
    )
    const kind = comp.type?.toLowerCase()
    if (kind === 'header') {
      const header = texts.filter((t): t is string => t !== null)
      if (header.length) out.header = header.slice(0, 1)
    } else if (kind === 'body') out.body = texts.map((t) => t ?? '')
    else if (kind === 'button' && comp.index !== undefined) {
      const value = texts.find((t): t is string => t !== null)
      if (value !== undefined) out.buttons = { ...out.buttons, [String(comp.index)]: [value] }
    }
  }
  return out
}

/** Plain text of a snapshot for search and accessible names: header text, body, footer. */
export function snapshotText(s: MessageTemplateSnapshot): string {
  return [s.header?.type === 'TEXT' ? s.header.text : null, s.body, s.footer]
    .filter(Boolean)
    .join('\n')
}
