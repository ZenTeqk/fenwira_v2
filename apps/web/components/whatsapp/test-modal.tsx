'use client'

import { type TestConnectionResult, type WhatsAppConnection } from '@fenwira/contracts'
import { Alert, Button, Field, Input, Modal, ModalClose, ModalContent } from '@fenwira/ui'
import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { post } from '@/lib/api/client'

/**
 * Test Connection: a live Graph check, plus an optional hello_world template to a number the
 * user enters. The send is a temporary direct call that Phase 5 routes through MessagingService.
 */
export function TestConnectionModal({
  connection,
  onOpenChange,
  onDone,
}: {
  connection: WhatsAppConnection | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const [to, setTo] = useState('')
  const test = useMutation({
    mutationFn: () =>
      post<{ data: TestConnectionResult }>(`/whatsapp/connections/${connection!.id}/test`, {
        ...(to.trim() ? { to } : {}),
      }).then((r) => r.data),
    onSettled: onDone,
  })
  const result = test.data

  return (
    <Modal
      open={connection !== null}
      onOpenChange={(open) => {
        if (!open) {
          test.reset()
          setTo('')
        }
        onOpenChange(open)
      }}
    >
      <ModalContent
        title="Test connection"
        description={`Checks ${connection?.displayPhoneNumber ?? 'this number'} with Meta right now.`}
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Close</Button>
            </ModalClose>
            <Button type="submit" form="test-connection-form" loading={test.isPending}>
              {to.trim() ? 'Run test and send' : 'Run test'}
            </Button>
          </>
        }
      >
        <form
          id="test-connection-form"
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            test.mutate()
          }}
        >
          <FormError error={test.error} />
          {result?.ok ? (
            <Alert tone="success" title="Meta reached this number">
              {result.message
                ? 'A hello_world test message was sent. It can take a few seconds to arrive.'
                : 'The connection works.'}
            </Alert>
          ) : null}
          {result && !result.ok ? (
            <Alert tone="danger" title="The test failed">
              {result.error?.message}
            </Alert>
          ) : null}
          <Field
            label="Send a test message to (optional)"
            hint="International format, for example +91 98765 43210. Sends Meta's hello_world template."
            error={fieldError(test.error, 'to')}
          >
            <Input
              type="tel"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              autoComplete="off"
            />
          </Field>
        </form>
      </ModalContent>
    </Modal>
  )
}
