'use client'

import { type Flow, type FlowVersion } from '@fenwira/contracts'
import { Button, cn, Field, Input, Label, RadioGroup, RadioGroupItem, toast } from '@fenwira/ui'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ApiError, get, post, put } from '@/lib/api/client'
import { RECIPES } from '@/lib/automation-recipes'

const BLANK = 'blank'

/**
 * Name, priority and a starting point: blank, or a starter recipe for a common automation. A
 * recipe is saved as the flow's first draft in the same format the builder edits.
 */
export function CreateFlowForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [priority, setPriority] = useState('100')
  const [start, setStart] = useState(BLANK)
  const [error, setError] = useState<string>()
  const recipe = RECIPES.find((r) => r.id === start)
  const create = useMutation({
    mutationFn: async () => {
      const flow = (
        await post<{ data: Flow }>('/flows', {
          name: name.trim(),
          priority: Number(priority) || 100,
        })
      ).data
      if (recipe) {
        const draft = (await get<{ data: FlowVersion }>(`/flows/${flow.id}/draft`)).data
        await put(
          `/flows/${flow.id}/draft`,
          { graph: recipe.graph() },
          { headers: { 'If-Match': draft.etag } },
        )
      }
      return flow
    },
    onSuccess: (flow) => {
      if (recipe) toast.success(`Started from “${recipe.title}”. ${recipe.todo}`)
      router.push(`/automations/${flow.id}`)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.field('name')) setError(e.field('name'))
      else toast.error(e instanceof ApiError ? e.message : 'Could not create the automation.')
    },
  })
  return (
    <form
      className="flex max-w-3xl flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return setError('Give the automation a name.')
        create.mutate()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" error={error} required className="sm:col-span-2">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(undefined)
            }}
            maxLength={120}
          />
        </Field>
        <Field label="Priority" hint="Lower numbers run first when several match.">
          <Input
            type="number"
            min={0}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-md font-semibold text-slate">Start from</legend>
        <RadioGroup value={start} onValueChange={setStart} className="grid gap-3 sm:grid-cols-2">
          {[
            {
              id: BLANK,
              title: 'Blank',
              description: 'Build your own with the canvas or the outline.',
            },
            ...RECIPES,
          ].map((r) => (
            <Label
              key={r.id}
              htmlFor={`start-${r.id}`}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-4 font-normal',
                start === r.id ? 'border-primary ring-1 ring-primary' : 'border-border',
              )}
            >
              <RadioGroupItem id={`start-${r.id}`} value={r.id} className="mt-0.5" />
              <span className="flex flex-col gap-1">
                <span className="font-medium text-slate">{r.title}</span>
                <span className="text-sm text-secondary">{r.description}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      <div>
        <Button type="submit" loading={create.isPending}>
          Create and open the builder
        </Button>
      </div>
    </form>
  )
}
