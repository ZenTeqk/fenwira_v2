import { Button, EmptyState } from '@fenwira/ui'
import { Compass } from 'lucide-react'
import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <EmptyState
        icon={<Compass aria-hidden="true" />}
        title="Page not found"
        description="The page you are looking for does not exist or has moved."
        action={
          <Button asChild variant="secondary">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        }
      />
    </main>
  )
}
