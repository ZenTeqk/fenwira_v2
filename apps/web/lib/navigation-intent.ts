'use client'

export const NAVIGATION_INTENT = 'fenwira:navigation-intent'
export type NavigationIntentEvent = CustomEvent<{ destination: string; proceed: () => void }>

/** Preserve synchronous navigation unless an active editor explicitly protects unsaved work. */
export function requestNavigation(destination: string, proceed: () => void) {
  const event: NavigationIntentEvent = new CustomEvent(NAVIGATION_INTENT, {
    cancelable: true,
    detail: { destination, proceed },
  })
  if (window.dispatchEvent(event)) proceed()
}
