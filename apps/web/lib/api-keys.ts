'use client'

import { type ApiKey, type CreateApiKeyRequest, type CreatedApiKey } from '@fenwira/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { del, get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

/** Tenant API keys (docs/API_KEYS.md, decisions P11-D18, P11-D22). */

export function useApiKeys() {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'api-keys'),
    queryFn: () => get<{ data: ApiKey[] }>('/api-keys').then((r) => r.data),
    enabled: can('integrations.manage'),
  })
}

export function useCreateApiKey() {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateApiKeyRequest) =>
      post<{ data: CreatedApiKey }>('/api-keys', input).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'api-keys') })
    },
  })
}

export function useRevokeApiKey() {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`/api-keys/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'api-keys') })
    },
  })
}
