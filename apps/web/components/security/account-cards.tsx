'use client'

import { type User } from '@fenwira/contracts'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  Input,
  toast,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

export function ProfileCard() {
  const { me } = useSession()
  const queryClient = useQueryClient()
  const [name, setName] = useState(me.user.name)
  const save = useMutation({
    mutationFn: () => patch<{ data: User }>('/me', { name }),
    onSuccess: () => {
      toast.success('Profile updated')
      void queryClient.invalidateQueries({ queryKey: keys.me })
    },
  })
  return (
    <Card>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Signed in as {me.user.email}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FormError error={save.error} />
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="submit"
            loading={save.isPending}
            disabled={!name.trim() || name === me.user.name}
          >
            Save
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

export function PasswordCard() {
  const queryClient = useQueryClient()
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNext] = useState('')
  const change = useMutation({
    mutationFn: () => post('/me/password', { currentPassword, newPassword }),
    onSuccess: () => {
      toast.success('Password changed. Your other sessions were signed out.')
      setCurrent('')
      setNext('')
      void queryClient.invalidateQueries({ queryKey: keys.sessions })
    },
  })
  return (
    <Card>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          change.mutate()
        }}
      >
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Changing it signs you out everywhere else.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {fieldError(change.error, 'newPassword') ? null : <FormError error={change.error} />}
          <Field label="Current password">
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field
            label="New password"
            hint="At least 10 characters."
            error={fieldError(change.error, 'newPassword')}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="submit"
            loading={change.isPending}
            disabled={!currentPassword || newPassword.length < 10}
          >
            Change password
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
