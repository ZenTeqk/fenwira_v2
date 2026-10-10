'use client'
import { use } from 'react'
import { WorkspaceCommercialView } from '@/components/platform/workspace-commercial-view'
export default function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  return <WorkspaceCommercialView id={use(params).workspaceId} />
}
