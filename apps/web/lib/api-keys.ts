'use client'

import { type ApiKey, type CreateApiKeyRequest, type CreatedApiKey } from '@fenwira/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { del, get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

/** Tenant API keys (docs/API_KEYS.md, decisions P11-D18, P11-D22). */

type ApiKeysResponse = { data: ApiKey[]; meta?: { entitled: boolean } }

function useApiKeysQuery<T>(select: (r: ApiKeysResponse) => T) {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'api-keys'),
    queryFn: () => get<ApiKeysResponse>('/api-keys'),
    enabled: can('integrations.manage'),
    select,
  })
}

export const useApiKeys = () => useApiKeysQuery((r) => r.data)
/** Phase 11 Step 4: false = suspended by plan (keys kept, requests get 403). Same request as the list. */
export const useApiEntitled = () => useApiKeysQuery((r) => r.meta?.entitled ?? true)

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
