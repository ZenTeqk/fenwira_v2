'use client'

import {
  type Message,
  type MessageStatus,
  type TestConnectionResult,
  type WhatsAppConnection,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Field,
  Input,
  Modal,
  ModalClose,
  ModalContent,
  StatusBadge,
} from '@fenwira/ui'
import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { get, post } from '@/lib/api/client'
import { useRealtimeEvent } from '@/lib/realtime'

const FINAL: MessageStatus[] = ['READ', 'FAILED']

/**
 * Test Connection: a live Graph check of the number and token, plus an optional hello_world
 * template to a number the user enters. The message goes through the messaging engine
 * (POST /conversations), and its status updates live: queued → sent → delivered → read.
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
  const [message, setMessage] = useState<Pick<Message, 'id' | 'status' | 'errorCode'> | null>(null)

  const check = useMutation({
    mutationFn: () =>
      post<{ data: TestConnectionResult }>(`/whatsapp/connections/${connection!.id}/test`).then(
        (r) => r.data,
      ),
    onSettled: onDone,
  })
  const send = useMutation({
    mutationFn: () =>
      post<{ data: Message }>(
        '/conversations',
        {
          to,
          phoneNumberId: connection!.id,
          content: { type: 'TEMPLATE', name: 'hello_world', language: 'en_US' },
        },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      ).then((r) => r.data),
    onSuccess: (m) => {
      setMessage(m)
      // Fallback in case a realtime event is missed: re-read until the status is final.
      const poll = async (attempt: number) => {
        if (attempt > 20) return
        const fresh = await get<{ data: Message }>(`/messages/${m.id}`).then((r) => r.data)
        setMessage((cur) => (cur?.id === fresh.id ? fresh : cur))
        if (!FINAL.includes(fresh.status)) setTimeout(() => void poll(attempt + 1), 3000)
      }
      setTimeout(() => void poll(0), 3000)
    },
  })
  useRealtimeEvent<{ messageId: string; status: MessageStatus; errorCode?: string }>(
    'message.status',
    (e) =>
      setMessage((cur) =>
        cur?.id === e.messageId
          ? { ...cur, status: e.status, errorCode: e.errorCode ?? null }
          : cur,
      ),
  )

  const result = check.data
  return (
    <Modal
      open={connection !== null}
      onOpenChange={(open) => {
        if (!open) {
          check.reset()
          send.reset()
          setMessage(null)
          setTo('')
        }
        onOpenChange(open)
      }}
    >
      <ModalContent
        title="Test connection"
        description={`Checks ${connection?.displayPhoneNumber ?? 'this number'} with Meta right now.`}
        footer={
          <ModalClose asChild>
            <Button variant="secondary">Close</Button>
          </ModalClose>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <FormError error={check.error} />
            {result?.ok ? (
              <Alert tone="success" title="Meta reached this number">
                The number and its access token work.
              </Alert>
            ) : null}
            {result && !result.ok ? (
              <Alert tone="danger" title="The test failed">
                {result.error?.message}
              </Alert>
            ) : null}
            <Button
              variant="secondary"
              className="self-start"
              loading={check.isPending}
              onClick={() => check.mutate()}
            >
              Run test
            </Button>
          </div>
          <form
            className="flex flex-col gap-3 border-t border-border-subtle pt-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              setMessage(null)
              send.mutate()
            }}
          >
            <FormError error={send.error} />
            <Field
              label="Send a test message to"
              hint="International format, for example +91 98765 43210. Sends Meta's hello_world template."
              error={fieldError(send.error, 'to')}
            >
              <Input
                type="tel"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                autoComplete="off"
                required
              />
            </Field>
            {message ? (
              <p className="flex items-center gap-2 text-sm text-fg-muted" aria-live="polite">
                Test message: <StatusBadge status={message.status} />
                {message.errorCode ? <span className="font-mono">{message.errorCode}</span> : null}
              </p>
            ) : null}
            <Button type="submit" className="self-start" loading={send.isPending}>
              Send test message
            </Button>
          </form>
        </div>
      </ModalContent>
    </Modal>
  )
}
