import Link from 'next/link'
import { type ReactNode } from 'react'

/** next/link adapter for @fenwira/ui components that accept `linkAs`. */
export function AppLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: ReactNode
}) {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}
