'use client'

import {
  type Campaign,
  type Contact,
  type Conversation,
  type Flow,
  type Template,
} from '@fenwira/contracts'
import { type CommandGroup } from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { createElement, useEffect, useMemo, useState } from 'react'
import {
  FileText,
  LayoutGrid,
  Megaphone,
  MessageSquare,
  Plus,
  User,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { useSession } from '@/components/session/session-provider'
import { get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { flattenLeaves, type NavItem } from '@/lib/navigation'

const PER_GROUP = 5
const icon = (I: LucideIcon) => createElement(I, { 'aria-hidden': true })

function useDebounced(value: string, ms = 200) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * Command palette groups (UX_PATTERNS → Command palette): Go to, Create, and record search across
 * contacts, conversations, campaigns, templates and automations using the existing list/search
 * endpoints. Permission-aware; no AI.
 */
export function useCommandGroups({
  nav,
  search,
  open,
  galleryEnabled,
}: {
  nav: NavItem[]
  search: string
  open: boolean
  galleryEnabled: boolean
}): { groups: CommandGroup[]; loading: boolean } {
  const router = useRouter()
  const { tenantId, can } = useSession()
  const q = useDebounced(search.trim())
  const active = open && q.length >= 2
  const key = (what: string) => keys.tenant(tenantId, 'command', what, q)

  const contacts = useQuery({
    queryKey: key('contacts'),
    queryFn: () =>
      post<{ data: Contact[] }>('/contacts/search', { q, limit: PER_GROUP }).then((r) => r.data),
    enabled: active && can('contacts.read'),
  })
  const conversations = useQuery({
    queryKey: key('conversations'),
    queryFn: () =>
      get<{ data: Conversation[] }>(
        `/conversations?view=all&limit=${PER_GROUP}&q=${encodeURIComponent(q)}`,
      ).then((r) => r.data),
    enabled: active && can('inbox.read'),
  })
  const templates = useQuery({
    queryKey: key('templates'),
    queryFn: () =>
      get<{ data: Template[] }>(`/templates?q=${encodeURIComponent(q)}`).then((r) => r.data),
    enabled: active && can('templates.read'),
  })
  // Campaigns and flows have no server-side search; their lists are small and cached.
  const campaigns = useQuery({
    queryKey: keys.tenant(tenantId, 'campaigns', 'list'),
    queryFn: () => get<{ data: Campaign[] }>('/campaigns').then((r) => r.data),
    enabled: active && can('campaigns.read'),
  })
  const flows = useQuery({
    queryKey: keys.tenant(tenantId, 'automation', 'flows'),
    queryFn: () => get<{ data: Flow[] }>('/flows').then((r) => r.data),
    enabled: active && can('automations.read'),
  })

  const groups = useMemo(() => {
    const leaves = flattenLeaves(nav)
    const go = (href: string) => () => router.push(href)
    const out: CommandGroup[] = [
      {
        heading: 'Go to',
        items: leaves
          .filter((l) => l.kind !== 'action')
          .map((leaf) => ({
            id: leaf.id,
            label:
              leaf.group && leaf.group !== leaf.label
                ? `${leaf.group} › ${leaf.label}`
                : leaf.label,
            keywords: leaf.group ? [leaf.group] : undefined,
            onSelect: go(leaf.href),
          })),
      },
      {
        heading: 'Create',
        items: [
          ...(can('contacts.write')
            ? [{ id: 'create-contact', label: 'New contact', href: '/contacts?new=1' }]
            : []),
          ...leaves
            .filter((l) => l.kind === 'action')
            .map((l) => ({ id: l.id, label: l.label, href: l.href })),
        ].map((c) => ({
          id: c.id,
          label: c.label,
          icon: icon(Plus),
          keywords: ['create', 'new', 'add'],
          onSelect: go(c.href),
        })),
      },
    ]
    if (!active) {
      if (galleryEnabled)
        out.push({
          heading: 'Developer',
          items: [
            {
              id: 'dev-ui',
              label: 'Component gallery',
              icon: icon(LayoutGrid),
              keywords: ['design', 'ui'],
              onSelect: go('/dev/ui'),
            },
          ],
        })
      return out
    }
    const needle = q.toLowerCase()
    const hit = (s: string | null | undefined) => !!s && s.toLowerCase().includes(needle)
    // Server results already match; the query is added as a keyword so the palette's own
    // text filter never hides them (e.g. a phone-number match on a named contact).
    const kw = [q]
    out.push(
      {
        heading: 'Contacts',
        items: (contacts.data ?? []).slice(0, PER_GROUP).map((c) => ({
          id: `contact-${c.id}`,
          label: c.name ? `${c.name} · ${c.phoneE164}` : c.phoneE164,
          icon: icon(User),
          keywords: kw,
          onSelect: go(`/contacts/${c.id}`),
        })),
      },
      {
        heading: 'Conversations',
        items: (conversations.data ?? []).slice(0, PER_GROUP).map((c) => ({
          id: `conversation-${c.id}`,
          label: `${c.contact.name ?? c.contact.waProfileName ?? c.contact.phoneE164}${c.snippet ? ` — ${c.snippet}` : ''}`,
          icon: icon(MessageSquare),
          keywords: kw,
          onSelect: go(`/inbox?c=${c.id}`),
        })),
      },
      {
        heading: 'Campaigns',
        items: (campaigns.data ?? [])
          .filter((c) => hit(c.name))
          .slice(0, PER_GROUP)
          .map((c) => ({
            id: `campaign-${c.id}`,
            label: c.name,
            icon: icon(Megaphone),
            keywords: kw,
            onSelect: go(`/campaigns/${c.id}`),
          })),
      },
      {
        heading: 'Templates',
        items: (templates.data ?? []).slice(0, PER_GROUP).map((t) => ({
          id: `template-${t.id}`,
          label: `${t.name} (${t.language})`,
          icon: icon(FileText),
          keywords: kw,
          onSelect: go(`/templates/${t.id}`),
        })),
      },
      {
        heading: 'Automations',
        items: (flows.data ?? [])
          .filter((f) => hit(f.name))
          .slice(0, PER_GROUP)
          .map((f) => ({
            id: `flow-${f.id}`,
            label: f.name,
            icon: icon(Workflow),
            keywords: kw,
            onSelect: go(`/automations/${f.id}`),
          })),
      },
    )
    return out
  }, [
    nav,
    active,
    q,
    can,
    router,
    galleryEnabled,
    contacts.data,
    conversations.data,
    templates.data,
    campaigns.data,
    flows.data,
  ])

  const loading =
    active &&
    [contacts, conversations, templates, campaigns, flows].some((r) => r.isFetching && !r.data)
  return { groups, loading }
}
