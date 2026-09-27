'use client'

import { ExternalLink } from 'lucide-react'
import { type ComponentType, type ReactNode } from 'react'
import { Button } from './button'
import { Drawer, DrawerContent } from './modal'

type LinkLike = ComponentType<{ href: string; className?: string; children: ReactNode }>

export type DetailDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  /** The full detail page; the drawer is for quick inspection (UX_PATTERNS → Drawers vs pages). */
  fullHref?: string
  fullLabel?: string
  linkAs?: LinkLike
  footer?: ReactNode
  children: ReactNode
}

/** Right-side inspection panel that keeps the list in context. */
export function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  fullHref,
  fullLabel = 'Open full page',
  linkAs: LinkComp,
  footer,
  children,
}: DetailDrawerProps) {
  const link = fullHref ? (
    <Button variant="secondary" asChild>
      {LinkComp ? (
        <LinkComp href={fullHref}>
          {fullLabel}
          <ExternalLink aria-hidden="true" />
        </LinkComp>
      ) : (
        <a href={fullHref}>
          {fullLabel}
          <ExternalLink aria-hidden="true" />
        </a>
      )}
    </Button>
  ) : null
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={title}
        description={description}
        width="lg"
        footer={
          footer || link ? (
            <>
              {link}
              {footer}
            </>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-5">{children}</div>
      </DrawerContent>
    </Drawer>
  )
}
