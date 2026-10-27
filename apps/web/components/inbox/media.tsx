'use client'

import { Modal, ModalContent } from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import Image from 'next/image'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

/** Short-lived download URL for a stored file (message media or a template header). */
export function useFileUrl(fileId: string | null | undefined) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'file-url', fileId ?? ''),
    queryFn: () =>
      get<{ data: { url: string } }>(`/files/${fileId}/download-url`).then((r) => r.data.url),
    enabled: !!fileId,
    staleTime: 240_000,
  })
}

export type ViewerItem = { fileId: string; kind: 'IMAGE' | 'VIDEO'; label: string }

/** Simple lightbox for thread images and videos (the inbox has no other media viewer). */
export function MediaLightbox({ item, onClose }: { item: ViewerItem | null; onClose: () => void }) {
  const url = useFileUrl(item?.fileId)
  return (
    <Modal open={!!item} onOpenChange={(open) => (open ? null : onClose())}>
      {item ? (
        <ModalContent title={item.label} className="max-w-3xl">
          <div className="flex justify-center px-5 pb-5">
            {!url.data ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : item.kind === 'IMAGE' ? (
              <Image
                src={url.data}
                unoptimized
                width={960}
                height={720}
                alt={item.label}
                className="h-auto max-h-160 w-auto max-w-full rounded-md"
              />
            ) : (
              // Customer media has no captions to offer; controls are native and keyboard-ready.
              <video src={url.data} controls className="max-h-160 max-w-full rounded-md">
                <track kind="captions" />
              </video>
            )}
          </div>
        </ModalContent>
      ) : null}
    </Modal>
  )
}

const size = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${size.format(bytes / 1024)} KB`
  return `${size.format(bytes / (1024 * 1024))} MB`
}

/** "PDF", "DOCX", … from the file name or MIME type. */
export function fileType(filename: string | null, mimeType: string | null): string {
  const ext = filename?.match(/\.([a-z0-9]{1,8})$/i)?.[1]
  if (ext) return ext.toUpperCase()
  const sub = mimeType?.split('/')[1]?.split(/[.+-]/).at(-1)
  return sub ? sub.toUpperCase() : 'File'
}
