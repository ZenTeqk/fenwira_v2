'use client'

import { type ConnectionStep, type WhatsAppConnection } from '@fenwira/contracts'
import { Alert, Button, Field, Input, Modal, ModalClose, ModalContent } from '@fenwira/ui'
import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { ApiError, post } from '@/lib/api/client'
import { ConnectionSteps } from './steps'

/**
 * Developer connect (WHATSAPP_DEV_CONNECT only): the Meta test number plus a system-user token
 * from the Meta developer dashboard. The token goes straight to the API and is never kept here.
 */
export function DevConnectModal({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: (connection: WhatsAppConnection) => void
}) {
  const [wabaId, setWabaId] = useState('')
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const connect = useMutation({
    mutationFn: () =>
      post<{ data: WhatsAppConnection }>('/whatsapp/connections/dev', {
        wabaId,
        phoneNumberId,
        accessToken,
      }),
    onSuccess: (res) => {
      setAccessToken('')
      onConnected(res.data)
      onOpenChange(false)
    },
    onError: () => setAccessToken(''),
  })
  const failedSteps =
    connect.error instanceof ApiError
      ? (connect.error.details?.steps as ConnectionStep[] | undefined)
      : undefined

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title="Developer connect"
        description="Connect Meta's test number using a system-user token. Available only when developer connect is enabled on this server."
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button type="submit" form="dev-connect-form" loading={connect.isPending}>
              Connect number
            </Button>
          </>
        }
      >
        <form
          id="dev-connect-form"
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            connect.mutate()
          }}
        >
          {failedSteps ? (
            <Alert tone="danger" title="Connection failed">
              <ConnectionSteps steps={failedSteps} />
            </Alert>
          ) : (
            <FormError error={connect.error} />
          )}
          <Field label="WhatsApp Business Account ID" error={fieldError(connect.error, 'wabaId')}>
            <Input
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              inputMode="numeric"
              required
              autoFocus
            />
          </Field>
          <Field label="Phone number ID" error={fieldError(connect.error, 'phoneNumberId')}>
            <Input
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              inputMode="numeric"
              required
            />
          </Field>
          <Field
            label="Access token"
            hint="Stored encrypted. It is never shown again."
            error={fieldError(connect.error, 'accessToken')}
          >
            <Input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              autoComplete="off"
              required
            />
          </Field>
        </form>
      </ModalContent>
    </Modal>
  )
}
