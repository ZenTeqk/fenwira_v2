import { type GraphSendRequest, type SendableContent } from '@fenwira/contracts'
import { MEDIA_PLACEHOLDER } from '@fenwira/whatsapp'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MEDIA_KINDS = ['image', 'video', 'document']

type Param = Record<string, unknown> & { type?: unknown }

/**
 * A Meta Cloud API send body as Fenwira content (docs/API_KEYS.md → Meta-compatible send). A
 * template header whose media `id` is a Fenwira file (from `POST /graph/{id}/media`) becomes the
 * send's header file: MEDIA_PLACEHOLDER in the components, uploaded to Meta by the outbound worker
 * like any template header. A `link`, or an id that isn't a Fenwira file, goes to Meta unchanged.
 */
export function graphSendToContent(body: GraphSendRequest): SendableContent {
  if (body.type === 'text')
    return { type: 'TEXT', text: body.text!.body, previewUrl: body.text!.preview_url }
  const template = body.template!
  let headerFileId: string | undefined
  const components = (template.components ?? []).map((c) => {
    const comp = c as { type?: unknown; parameters?: unknown }
    if (String(comp?.type).toLowerCase() !== 'header' || !Array.isArray(comp.parameters)) return c
    return {
      ...comp,
      parameters: (comp.parameters as Param[]).map((p) => {
        const kind = String(p?.type)
        const media = MEDIA_KINDS.includes(kind) ? (p[kind] as { id?: unknown } | undefined) : null
        if (!media || typeof media.id !== 'string' || !UUID_RE.test(media.id)) return p
        headerFileId = media.id
        return { ...p, [kind]: { ...media, id: MEDIA_PLACEHOLDER } }
      }),
    }
  })
  return {
    type: 'TEMPLATE',
    name: template.name,
    language: template.language.code,
    ...(components.length ? { components } : {}),
    ...(headerFileId ? { variables: { body: [], headerFileId } } : {}),
  }
}
