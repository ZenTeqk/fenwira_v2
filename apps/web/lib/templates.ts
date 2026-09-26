'use client'

import {
  type ApprovedTemplate,
  AUTH_BODY_TEXT,
  type Template,
  type TemplateAccount,
  type TemplateCategory,
  type TemplateDraft,
  type TemplateVersion,
} from '@fenwira/contracts'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

/** Languages Meta supports that Fenwira customers use most; any Meta code is accepted by the API. */
export const TEMPLATE_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'en_US', label: 'English (US)' },
  { code: 'en_GB', label: 'English (UK)' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'kn', label: 'Kannada' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'mr', label: 'Marathi' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'ur', label: 'Urdu' },
  { code: 'ar', label: 'Arabic' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt_BR', label: 'Portuguese (Brazil)' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'id', label: 'Indonesian' },
]
export const languageLabel = (code: string) =>
  TEMPLATE_LANGUAGES.find((l) => l.code === code)?.label ?? code

export const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utility',
  AUTHENTICATION: 'Authentication',
}
export const CATEGORY_HINT: Record<TemplateCategory, string> = {
  MARKETING: 'Promotions, offers and announcements. Needs marketing consent.',
  UTILITY: 'Updates about an order, booking or account the customer asked for.',
  AUTHENTICATION: 'One-time passcodes. Meta sets the message text.',
}

export const templatesKey = (tenantId: string, ...rest: Array<string | null | undefined>) =>
  keys.tenant(tenantId, 'templates', ...rest.map((r) => r ?? 'none'))

export function emptyDraft(category: TemplateCategory = 'UTILITY'): TemplateDraft {
  if (category === 'AUTHENTICATION')
    return {
      name: '',
      language: 'en',
      category,
      components: {
        body: { text: AUTH_BODY_TEXT },
        buttons: [{ type: 'COPY_CODE', example: '123456' }],
        auth: { securityRecommendation: true, codeExpirationMinutes: 10 },
      },
      samples: { body: ['123456'] },
    }
  return {
    name: '',
    language: 'en',
    category,
    components: { body: { text: '' } },
    samples: { body: [] },
  }
}

export const draftOf = (t: Template, v: TemplateVersion = t.currentVersion): TemplateDraft => ({
  name: t.name,
  language: t.language,
  category: t.category,
  components: v.components,
  samples: v.samples,
})

export function useTemplates(params: URLSearchParams) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: templatesKey(tenantId, 'list', params.toString()),
    queryFn: () => get<{ data: Template[] }>(`/templates?${params}`).then((r) => r.data),
  })
}

export function useTemplate(id: string) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: templatesKey(tenantId, 'one', id),
    queryFn: () => get<{ data: Template }>(`/templates/${id}`).then((r) => r.data),
    // While Meta reviews it, poll so the status flips without a reload.
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 3000 : false),
  })
}

export function useTemplateVersions(id: string) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: templatesKey(tenantId, 'versions', id),
    queryFn: () =>
      get<{ data: TemplateVersion[] }>(`/templates/${id}/versions`).then((r) => r.data),
  })
}

export function useTemplateAccounts() {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: templatesKey(tenantId, 'accounts'),
    queryFn: () => get<{ data: TemplateAccount[] }>('/templates/accounts').then((r) => r.data),
  })
}

/** Approved templates for a number (the inbox picker). */
export function useApprovedTemplates(phoneNumberId?: string, enabled = true) {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: templatesKey(tenantId, 'approved', phoneNumberId ?? 'all'),
    queryFn: () =>
      get<{ data: ApprovedTemplate[] }>(
        `/templates/approved${phoneNumberId ? `?phoneNumberId=${phoneNumberId}` : ''}`,
      ).then((r) => r.data),
    enabled: enabled && can('templates.read'),
    staleTime: 30_000,
  })
}
