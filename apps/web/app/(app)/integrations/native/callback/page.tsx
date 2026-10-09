'use client'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, DetailPage } from '@fenwira/ui'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { post } from '@/lib/api/client'

export default function NativeCallbackPage() {
  const { tenantId, can } = useSession()
  const attempted = useRef(false)
  const [status, setStatus] = useState('Completing authorization…')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (attempted.current) return
    attempted.current = true
    const params = new URLSearchParams(location.search)
    // Remove authorization codes from browser history and outgoing referrers immediately.
    history.replaceState(null, '', '/integrations/native/callback')
    const stored = sessionStorage.getItem('fenwira.native.authorization')
    sessionStorage.removeItem('fenwira.native.authorization')
    let expected: { state: string; tenantId: string } | null = null
    try {
      expected = stored ? JSON.parse(stored) : null
    } catch {
      // Malformed browser state fails the authorization check below.
    }
    if (
      !can('integrations.manage') ||
      !expected ||
      expected.tenantId !== tenantId ||
      params.get('state') !== expected.state ||
      !params.get('code') ||
      params.has('error')
    ) {
      setFailed(true)
      setStatus(
        'Authorization could not be completed in this workspace. Return to Integrations and start again.',
      )
      return
    }
    const body: Record<string, string> = { state: expected.state, code: params.get('code')! }
    for (const name of ['shop', 'hmac', 'timestamp', 'host']) {
      const value = params.get(name)
      if (value) body[name] = value
    }
    void post('/native-connectors/oauth/complete', body)
      .then(() =>
        setStatus('Application connected. Return to Integrations to start a contact transfer.'),
      )
      .catch(() => {
        setFailed(true)
        setStatus(
          'Provider authorization failed or expired. Return to Integrations and start again.',
        )
      })
  }, [tenantId, can])
  return (
    <DetailPage header={{ title: 'Connect application' }}>
      <Alert
        tone={failed ? 'warning' : 'info'}
        title={failed ? 'Authorization needs attention' : 'Application authorization'}
      >
        {status}
      </Alert>
      <Button asChild>
        <Link href="/integrations">Return to Integrations</Link>
      </Button>
    </DetailPage>
  )
}
