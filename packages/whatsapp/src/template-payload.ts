import {
  AUTH_BODY_TEXT,
  requiredVariables,
  type TemplateButton,
  type TemplateCategory,
  type TemplateComponents,
  type TemplateStatus,
  type TemplateVariables,
  type VariableSamples,
  variableCount,
} from '@fenwira/contracts'
import { type MetaTemplate } from './client'

/**
 * Mapping between Fenwira's template model and Meta's (docs/TEMPLATE_ENGINE.md → Submission,
 * Sync, Rendering). Pure functions; the Graph calls live in GraphClient and the outbound worker.
 */

/** Stands in for the uploaded media id in a template header parameter until send time. */
export const MEDIA_PLACEHOLDER = '__FENWIRA_HEADER_MEDIA__'

type MetaComponent = Record<string, unknown>

/** `POST /{waba_id}/message_templates` (or the edit) body. `headerHandle` from the resumable upload. */
export function toMetaTemplatePayload(
  t: {
    name: string
    language: string
    category: TemplateCategory
    components: TemplateComponents
    samples: VariableSamples
  },
  headerHandle?: string,
): Record<string, unknown> {
  const { components: c, samples } = t
  const out: MetaComponent[] = []
  if (t.category === 'AUTHENTICATION') {
    out.push({
      type: 'BODY',
      add_security_recommendation: c.auth?.securityRecommendation ?? false,
    })
    if (c.auth?.codeExpirationMinutes)
      out.push({ type: 'FOOTER', code_expiration_minutes: c.auth.codeExpirationMinutes })
    out.push({ type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] })
    return { name: t.name, language: t.language, category: t.category, components: out }
  }
  if (c.header?.format === 'TEXT') {
    out.push({
      type: 'HEADER',
      format: 'TEXT',
      text: c.header.text,
      ...(variableCount(c.header.text) ? { example: { header_text: samples.header ?? [] } } : {}),
    })
  } else if (c.header) {
    out.push({
      type: 'HEADER',
      format: c.header.format,
      example: { header_handle: headerHandle ? [headerHandle] : [] },
    })
  }
  out.push({
    type: 'BODY',
    text: c.body.text,
    ...(variableCount(c.body.text) ? { example: { body_text: [samples.body] } } : {}),
  })
  if (c.footer?.text) out.push({ type: 'FOOTER', text: c.footer.text })
  if (c.buttons?.length)
    out.push({
      type: 'BUTTONS',
      buttons: c.buttons.map((b, i) => {
        switch (b.type) {
          case 'QUICK_REPLY':
            return { type: 'QUICK_REPLY', text: b.text }
          case 'URL': {
            const example = samples.buttons?.[String(i)]
            return {
              type: 'URL',
              text: b.text,
              url: b.url,
              ...(example?.length ? { example } : {}),
            }
          }
          case 'PHONE_NUMBER':
            return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phoneE164 }
          case 'COPY_CODE':
            return { type: 'COPY_CODE', example: b.example }
        }
      }),
    })
  return { name: t.name, language: t.language, category: t.category, components: out }
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Meta's template (from a sync) → our components and samples. Unsupported parts are dropped. */
export function fromMetaTemplate(t: MetaTemplate): {
  components: TemplateComponents
  samples: VariableSamples
} {
  const components: TemplateComponents = { body: { text: '' } }
  const samples: VariableSamples = { body: [] }
  for (const raw of t.components ?? []) {
    const comp = obj(raw)
    const type = str(comp.type).toUpperCase()
    const example = obj(comp.example)
    if (type === 'HEADER') {
      const format = str(comp.format).toUpperCase()
      if (format === 'TEXT') {
        components.header = { format: 'TEXT', text: str(comp.text) }
        const header = example.header_text
        if (Array.isArray(header)) samples.header = header.map(String)
      } else if (format === 'IMAGE' || format === 'VIDEO' || format === 'DOCUMENT') {
        components.header = { format, sampleFileId: null }
      }
    } else if (type === 'BODY') {
      if (t.category === 'AUTHENTICATION') {
        components.body = { text: AUTH_BODY_TEXT }
        components.auth = {
          securityRecommendation: Boolean(comp.add_security_recommendation),
          codeExpirationMinutes: null,
        }
        samples.body = ['123456']
      } else {
        components.body = { text: str(comp.text) }
        const body = example.body_text
        if (Array.isArray(body) && Array.isArray(body[0])) samples.body = body[0].map(String)
      }
    } else if (type === 'FOOTER') {
      if (t.category === 'AUTHENTICATION') {
        const minutes = Number(comp.code_expiration_minutes)
        components.auth = {
          securityRecommendation: components.auth?.securityRecommendation ?? false,
          codeExpirationMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
        }
      } else components.footer = { text: str(comp.text) }
    } else if (type === 'BUTTONS' && Array.isArray(comp.buttons)) {
      const buttons: TemplateButton[] = []
      comp.buttons.forEach((rawButton) => {
        const b = obj(rawButton)
        const kind = str(b.type).toUpperCase()
        if (kind === 'QUICK_REPLY') buttons.push({ type: 'QUICK_REPLY', text: str(b.text) })
        else if (kind === 'URL') {
          buttons.push({ type: 'URL', text: str(b.text), url: str(b.url) })
          if (Array.isArray(b.example) && b.example.length)
            (samples.buttons ??= {})[String(buttons.length - 1)] = [String(b.example[0])]
        } else if (kind === 'PHONE_NUMBER')
          buttons.push({ type: 'PHONE_NUMBER', text: str(b.text), phoneE164: str(b.phone_number) })
        else if (kind === 'COPY_CODE' || kind === 'OTP')
          buttons.push({ type: 'COPY_CODE', example: str(b.example) || '123456' })
      })
      if (buttons.length) components.buttons = buttons
    }
  }
  return { components, samples }
}

/** Meta's template status → ours (docs/TEMPLATE_ENGINE.md → Lifecycle). */
export function templateStatusFromMeta(status: string): TemplateStatus {
  switch (status.toUpperCase()) {
    case 'APPROVED':
    case 'REINSTATED':
    case 'FLAGGED':
      return 'APPROVED'
    case 'REJECTED':
      return 'REJECTED'
    case 'PAUSED':
      return 'PAUSED'
    case 'DISABLED':
    case 'DELETED':
    case 'PENDING_DELETION':
    case 'LIMIT_EXCEEDED':
      return 'DISABLED'
    default:
      return 'PENDING'
  }
}

export const templateCategoryFromMeta = (category: string): TemplateCategory =>
  (['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const).find((c) => c === category.toUpperCase()) ??
  'UTILITY'

/**
 * The `components` of a template send (parameters). A media header gets MEDIA_PLACEHOLDER; the
 * outbound worker uploads the file and substitutes the Meta media id.
 */
export function buildTemplateSendComponents(
  category: TemplateCategory,
  components: TemplateComponents,
  values: TemplateVariables,
): MetaComponent[] {
  const text = (t: string) => ({ type: 'text', text: t })
  if (category === 'AUTHENTICATION') {
    const code = values.body[0] ?? ''
    return [
      { type: 'body', parameters: [text(code)] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [text(code)] },
    ]
  }
  const need = requiredVariables(components)
  const out: MetaComponent[] = []
  if (need.header) out.push({ type: 'header', parameters: (values.header ?? []).map(text) })
  if (need.headerMedia) {
    const kind = need.headerMedia.toLowerCase()
    out.push({ type: 'header', parameters: [{ type: kind, [kind]: { id: MEDIA_PLACEHOLDER } }] })
  }
  if (need.body) out.push({ type: 'body', parameters: values.body.slice(0, need.body).map(text) })
  ;(components.buttons ?? []).forEach((b, i) => {
    const index = String(i)
    if (b.type === 'URL' && need.buttons[index])
      out.push({
        type: 'button',
        sub_type: 'url',
        index,
        parameters: [text(values.buttons?.[index]?.[0] ?? '')],
      })
    if (b.type === 'COPY_CODE')
      out.push({
        type: 'button',
        sub_type: 'copy_code',
        index,
        parameters: [
          { type: 'coupon_code', coupon_code: values.buttons?.[index]?.[0] || b.example },
        ],
      })
  })
  return out
}
