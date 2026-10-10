'use client'

import { type WhatsAppConnection } from '@fenwira/contracts'
import { Button, Field, Input, Modal, ModalClose, ModalContent } from '@fenwira/ui'
import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { patch, post } from '@/lib/api/client'

type ModalProps = {
  connection: WhatsAppConnection | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function RenameModal({ connection, onOpenChange, onSaved }: ModalProps) {
  const [label, setLabel] = useState('')
  useEffect(() => setLabel(connection?.label ?? ''), [connection])
  const save = useMutation({
    mutationFn: () =>
      patch(`/whatsapp/connections/${connection!.id}`, { label: label.trim() || null }),
    onSuccess: () => {
      onSaved()
      onOpenChange(false)
    },
  })
  return (
    <Modal open={connection !== null} onOpenChange={onOpenChange}>
      <ModalContent
        title="Rename number"
        description="A label to tell your numbers apart, such as “Support” or “Sales”."
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button type="submit" form="rename-form" loading={save.isPending}>
              Save
            </Button>
          </>
        }
      >
        <form
          id="rename-form"
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <FormError error={save.error} />
          <Field label="Label" error={fieldError(save.error, 'label')}>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={60}
              autoFocus
            />
          </Field>
        </form>
      </ModalContent>
    </Modal>
  )
}

/** Developer-connect token rotation (Embedded Signup rotation relaunches the Meta popup instead). */
export function RotateTokenModal({ connection, onOpenChange, onSaved }: ModalProps) {
  const [accessToken, setAccessToken] = useState('')
  const rotate = useMutation({
    mutationFn: () => post(`/whatsapp/connections/${connection!.id}/rotate-token`, { accessToken }),
    onSuccess: () => {
      onSaved()
      onOpenChange(false)
    },
    onSettled: () => setAccessToken(''),
  })
  return (
    <Modal open={connection !== null} onOpenChange={onOpenChange}>
      <ModalContent
        title="Rotate token"
        description="Paste a new system-user token for this WhatsApp Business Account. The old one is wiped."
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button type="submit" form="rotate-form" loading={rotate.isPending}>
              Rotate token
            </Button>
          </>
        }
      >
        <form
          id="rotate-form"
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            rotate.mutate()
          }}
        >
          <FormError error={rotate.error} />
          <Field label="New access token" error={fieldError(rotate.error, 'accessToken')}>
            <Input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              autoComplete="off"
              required
              autoFocus
            />
          </Field>
        </form>
      </ModalContent>
    </Modal>
  )
}
