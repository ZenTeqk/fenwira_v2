'use client'
import { platformAiActivationRequestSchema } from '@fenwira/contracts'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { platformRequest } from '@/lib/platform'

export const requestsKey = (status: string) => ['platform', 'ai-requests', status]

/** Open AI requests, for the nav badge (the operators' in-app notice). */
function useOpenAiRequests() {
  return useQuery({
    queryKey: requestsKey('REQUESTED'),
    retry: false,
    refetchInterval: 60_000,
    queryFn: async () =>
      z
        .array(platformAiActivationRequestSchema)
        .parse(await platformRequest('/ai/requests?status=REQUESTED')),
  })
}

export function AiRequestsNavLabel() {
  const open = useOpenAiRequests()
  const count = open.data?.length ?? 0
  return (
    <span className="flex w-full items-center justify-between gap-2">
      AI requests
      {count ? (
        <span className="rounded-full bg-info-soft px-2 text-xs font-semibold text-info-strong">
          {count}
          <span className="sr-only"> open</span>
        </span>
      ) : null}
    </span>
  )
}
