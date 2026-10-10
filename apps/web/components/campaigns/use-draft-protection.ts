'use client'

import { toast, useConfirm } from '@fenwira/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { NAVIGATION_INTENT, type NavigationIntentEvent } from '@/lib/navigation-intent'

/** Scope navigation protection to this campaign editor; no global navigation or persisted PII. */
export function useDraftProtection(dirty: boolean, busy: boolean, savedId?: string) {
  const confirm = useConfirm()
  const router = useRouter()
  const prompting = useRef(false)
  const editorFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!dirty && !busy) return
    const currentUrl = window.location.href
    const currentState: unknown = window.history.state
    let leaving = false
    const rememberFocus = () => {
      const focused = document.activeElement
      if (focused instanceof HTMLElement && focused.closest('[data-campaign-studio]'))
        editorFocus.current = focused
    }
    rememberFocus()
    const leave = async (url: URL, proceed?: () => void) => {
      if (prompting.current) return
      if (busy) {
        toast.info('Wait for the current campaign operation to finish.')
        return
      }
      const previousFocus = document.activeElement
      prompting.current = true
      try {
        if (
          await confirm({
            title: 'Leave with unsaved changes?',
            description:
              'Changes since your last save will be discarded. Your saved draft stays available.',
            confirmLabel: 'Discard changes',
            cancelLabel: 'Keep editing',
            destructive: true,
          })
        ) {
          leaving = true
          if (proceed) proceed()
          else router.push(`${url.pathname}${url.search}${url.hash}`)
        }
      } finally {
        prompting.current = false
        if (!leaving)
          requestAnimationFrame(() => {
            const target =
              previousFocus instanceof HTMLElement && previousFocus.isConnected
                ? previousFocus
                : editorFocus.current
            if (target?.isConnected) target.focus()
          })
      }
    }
    const intent = (event: Event) => {
      if (leaving) return
      const { destination, proceed } = (event as NavigationIntentEvent).detail
      const target = new URL(destination, currentUrl)
      if (target.href === currentUrl) return
      event.preventDefault()
      void leave(target, proceed)
    }
    const click = (event: MouseEvent) => {
      if (
        leaving ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download')
      )
        return
      const url = new URL(anchor.href, currentUrl),
        current = new URL(currentUrl)
      if (
        url.origin !== current.origin ||
        (url.pathname === current.pathname && url.search === current.search)
      )
        return
      event.preventDefault()
      event.stopPropagation()
      void leave(url)
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (!leaving) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const pop = (event: PopStateEvent) => {
      if (leaving) return
      const target = new URL(window.location.href)
      if (target.href === currentUrl) return
      // Keep the current editor and its Next history state until the user settles the dialog.
      // Capture precedes App Router's popstate listener; restoring this entry also supports Cancel.
      event.stopImmediatePropagation()
      window.history.pushState(currentState, '', currentUrl)
      void leave(target)
    }
    // Navigation API can cancel a browser traversal before location or App Router changes.
    // Use it when available; older browsers retain popstate + native unload protection.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation
    const navigate = (event: Event) => {
      const traversal = event as Event & { navigationType: string; destination: { url: string } }
      if (leaving || traversal.navigationType !== 'traverse' || !event.cancelable) return
      const target = new URL(traversal.destination.url)
      if (target.origin !== window.location.origin || target.href === currentUrl) return
      event.preventDefault()
      void leave(target)
    }
    navigation?.addEventListener('navigate', navigate)
    window.addEventListener(NAVIGATION_INTENT, intent)
    document.addEventListener('focusin', rememberFocus, true)
    document.addEventListener('click', click, true)
    window.addEventListener('beforeunload', unload)
    window.addEventListener('popstate', pop, true)
    return () => {
      navigation?.removeEventListener('navigate', navigate)
      window.removeEventListener(NAVIGATION_INTENT, intent)
      document.removeEventListener('focusin', rememberFocus, true)
      document.removeEventListener('click', click, true)
      window.removeEventListener('beforeunload', unload)
      window.removeEventListener('popstate', pop, true)
    }
  }, [dirty, busy, savedId, confirm, router])
}
