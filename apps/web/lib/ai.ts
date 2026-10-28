'use client'

import {
  AI_KNOWLEDGE_MIME_TYPES,
  type AiKnowledgeMimeType,
  type AiKnowledgeSource,
  type AiOverview,
  type AiPlaygroundResponse,
  type AiReplyLog,
  type AiSettings,
  type AiUsage,
  type CreateAiFaqSourceRequest,
  type CreateAiTextSourceRequest,
  type Flow,
  type ReplaceAiSourceRequest,
  type UpdateAiSettingsRequest,
} from '@fenwira/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { ApiError, del, get, patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { useRealtimeEvent } from '@/lib/realtime'

/** AI Assistant (docs/AI_ASSISTANT.md). Every route answers AI_NOT_ENABLED (403) when off. */

export const isNotEnabled = (err: unknown) => err instanceof ApiError && err.code === 'AI_NOT_ENABLED'

const noRetryWhenOff = (count: number, err: unknown) => !isNotEnabled(err) && count < 2

function useAiKey() {
  const { tenantId } = useSession()
  return (...rest: string[]) => keys.tenant(tenantId, 'ai', ...rest)
}

export function useAiOverview() {
  const key = useAiKey()
  return useQuery({
    queryKey: key('overview'),
    queryFn: () => get<{ data: AiOverview }>('/ai/overview').then((r) => r.data),
    retry: noRetryWhenOff,
  })
}

export function useAiSettings(enabled = true) {
  const key = useAiKey()
  return useQuery({
    queryKey: key('settings'),
    queryFn: () => get<{ data: AiSettings }>('/ai/settings').then((r) => r.data),
    enabled,
    retry: noRetryWhenOff,
  })
}

/** Polls while anything is processing; realtime status pushes refresh it at once. */
export function useAiSources(enabled = true) {
  const key = useAiKey()
  const client = useQueryClient()
  useRealtimeEvent('ai.source.updated', () => {
    void client.invalidateQueries({ queryKey: key('knowledge') })
    void client.invalidateQueries({ queryKey: key('overview') })
  })
  return useQuery({
    queryKey: key('knowledge'),
    queryFn: () => get<{ data: AiKnowledgeSource[] }>('/ai/knowledge').then((r) => r.data),
    enabled,
    retry: noRetryWhenOff,
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.status === 'PROCESSING') ? 3000 : false,
  })
}

export function useAiSource(id: string | null) {
  const key = useAiKey()
  return useQuery({
    queryKey: key('knowledge', id ?? 'none'),
    queryFn: () =>
      get<{ data: AiKnowledgeSource & { body: unknown } }>(`/ai/knowledge/${id}`).then((r) => r.data),
    enabled: !!id,
  })
}

export function useAiUsage(enabled = true) {
  const key = useAiKey()
  return useQuery({
    queryKey: key('usage'),
    queryFn: () => get<{ data: AiUsage }>('/ai/usage').then((r) => r.data),
    enabled,
    retry: noRetryWhenOff,
  })
}

export function useAiActivity(enabled = true) {
  const key = useAiKey()
  return useQuery({
    queryKey: key('activity'),
    queryFn: () => get<{ data: AiReplyLog[] }>('/ai/activity?limit=50').then((r) => r.data),
    enabled,
    retry: noRetryWhenOff,
  })
}

function useAiMutation<I, O>(fn: (input: I) => Promise<O>, refresh: string[] = ['knowledge', 'overview']) {
  const key = useAiKey()
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of refresh) void client.invalidateQueries({ queryKey: key(k) })
    },
  })
}

export const useUpdateAiSettings = () =>
  useAiMutation(
    (input: UpdateAiSettingsRequest) =>
      patch<{ data: AiSettings }>('/ai/settings', input).then((r) => r.data),
    ['settings', 'overview'],
  )

export const useAddFaq = () =>
  useAiMutation((input: CreateAiFaqSourceRequest) =>
    post<{ data: AiKnowledgeSource }>('/ai/knowledge/faq', input).then((r) => r.data),
  )

export const useAddText = () =>
  useAiMutation((input: CreateAiTextSourceRequest) =>
    post<{ data: AiKnowledgeSource }>('/ai/knowledge/text', input).then((r) => r.data),
  )

export const useReplaceSource = () =>
  useAiMutation(({ id, input }: { id: string; input: ReplaceAiSourceRequest }) =>
    post<{ data: AiKnowledgeSource }>(`/ai/knowledge/${id}/replace`, input).then((r) => r.data),
  )

export const useReprocessSource = () =>
  useAiMutation((id: string) =>
    post<{ data: AiKnowledgeSource }>(`/ai/knowledge/${id}/reprocess`).then((r) => r.data),
  )

export const useDeleteSource = () =>
  useAiMutation((id: string) => del(`/ai/knowledge/${id}`))

export const usePlayground = () =>
  useAiMutation(
    (question: string) =>
      post<{ data: AiPlaygroundResponse }>('/ai/playground', { question }).then((r) => r.data),
    ['usage', 'overview', 'activity'],
  )

export const useTurnOnAssistant = () =>
  useAiMutation(
    () => post<{ data: Flow }>('/ai/assistant/turn-on', {}).then((r) => r.data),
    ['overview'],
  )

export const usePauseAssistant = () =>
  useAiMutation(
    () => post<{ data: Flow | null }>('/ai/assistant/pause', {}).then((r) => r.data),
    ['overview'],
  )

/** Extension → MIME type for the upload (browsers often send nothing for .md). */
const BY_EXTENSION = Object.fromEntries(
  Object.entries(AI_KNOWLEDGE_MIME_TYPES).map(([mime, ext]) => [ext, mime]),
) as Record<string, AiKnowledgeMimeType>
export const KNOWLEDGE_ACCEPT = Object.values(AI_KNOWLEDGE_MIME_TYPES).join(',')

export function knowledgeMimeOf(file: File): AiKnowledgeMimeType | null {
  const ext = /\.[a-z0-9]+$/i.exec(file.name)?.[0]?.toLowerCase() ?? ''
  return BY_EXTENSION[ext] ?? null
}

/** Presigned upload → source (new) or replacement (existing id). */
export function useUploadKnowledge() {
  const key = useAiKey()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, replaceId }: { file: File; replaceId?: string }) => {
      const mimeType = knowledgeMimeOf(file)
      if (!mimeType) throw new Error('Upload a PDF, Word (.docx), text, Markdown or CSV file.')
      const up = await post<{
        data: { fileId: string; url: string; headers: Record<string, string> }
      }>('/ai/knowledge/upload-url', { mimeType, sizeBytes: file.size, filename: file.name })
      const put = await fetch(up.data.url, { method: 'PUT', headers: up.data.headers, body: file })
      if (!put.ok) throw new Error('The upload did not finish. Check your connection and try again.')
      const done = replaceId
        ? await post<{ data: AiKnowledgeSource }>(`/ai/knowledge/${replaceId}/replace`, {
            fileId: up.data.fileId,
          })
        : await post<{ data: AiKnowledgeSource }>('/ai/knowledge/files', {
            fileId: up.data.fileId,
          })
      return done.data
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key('knowledge') })
      void client.invalidateQueries({ queryKey: key('overview') })
    },
  })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${Math.round(n / 1024)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}
