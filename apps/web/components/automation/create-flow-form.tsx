'use client'

import { type Flow } from '@fenwira/contracts'
import { Button, Field, Input, toast } from '@fenwira/ui'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ApiError, post } from '@/lib/api/client'

/** Name and priority; the builder opens next. */
export function CreateFlowForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [priority, setPriority] = useState('100')
  const [error, setError] = useState<string>()
  const create = useMutation({
    mutationFn: () =>
      post<{ data: Flow }>('/flows', { name: name.trim(), priority: Number(priority) || 100 }),
    onSuccess: (r) => router.push(`/automations/${r.data.id}`),
    onError: (e) => {
      if (e instanceof ApiError && e.field('name')) setError(e.field('name'))
      else toast.error(e instanceof ApiError ? e.message : 'Could not create the automation.')
    },
  })
  return (
    <form
      className="flex max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return setError('Give the automation a name.')
        create.mutate()
      }}
    >
      <Field label="Name" error={error} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </Field>
      <Field
        label="Priority"
        hint="When several automations match the same message, lower numbers run first."
      >
        <Input
          type="number"
          min={0}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" loading={create.isPending}>
          Create and open the builder
        </Button>
      </div>
    </form>
  )
}
