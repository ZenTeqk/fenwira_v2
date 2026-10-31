'use client'

import { useEffect, useRef, useState } from 'react'

const PREFERENCE_KEY = 'fenwira.sidebar.collapsed'

/** Hover/focus is temporary; only the explicit pin action changes the browser preference. */
export function useSidebarExpansion() {
  const rail = useRef<HTMLElement>(null)
  const [pinned, setPinned] = useState(false)
  const [temporary, setTemporary] = useState(false)

  useEffect(() => {
    try {
      setPinned(window.localStorage.getItem(PREFERENCE_KEY) === 'false')
    } catch {
      // Keep the default rail when storage is unavailable.
    }
    const sync = (event: StorageEvent) => {
      if (event.key === PREFERENCE_KEY || event.key === null) setPinned(event.newValue === 'false')
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  useEffect(() => {
    const root = rail.current
    if (!root) return
    const hover = window.matchMedia('(hover: hover) and (pointer: fine)')
    let enterTimer: ReturnType<typeof setTimeout> | undefined
    let leaveTimer: ReturnType<typeof setTimeout> | undefined
    let pointer: Node | null = null
    // Match the shared focus-visible accessibility treatment. Explicit input tracking also
    // handles a mouse click on a link that was already focused by the keyboard.
    let modality: 'pointer' | 'keyboard' | undefined
    const cancelEnter = () => {
      clearTimeout(enterTimer)
      enterTimer = undefined
    }

    // Radix menus/popovers are portaled. Follow their accessibility ownership instead of
    // treating every open popup on the page as belonging to this navigation.
    const ownedPortals = () => {
      const portals = new Set<HTMLElement>()
      const collect = (parent: HTMLElement) => {
        for (const trigger of parent.querySelectorAll(
          '[aria-controls], [aria-owns], [aria-describedby]',
        )) {
          for (const attribute of ['aria-controls', 'aria-owns', 'aria-describedby']) {
            for (const id of trigger.getAttribute(attribute)?.split(/\s+/) ?? []) {
              const element = document.getElementById(id)
              if (!element || root.contains(element) || portals.has(element)) continue
              if (element.hidden || element.dataset.state === 'closed') continue
              portals.add(element)
              collect(element)
            }
          }
        }
      }
      collect(root)
      return [...portals]
    }
    const inside = (target: Node | null) =>
      !!target && (root.contains(target) || ownedPortals().some((popup) => popup.contains(target)))
    const keyboardFocusInside = () =>
      inside(document.activeElement) &&
      (modality === 'keyboard' ||
        (modality === undefined && document.activeElement?.matches(':focus-visible')))
    const held = () =>
      inside(pointer) ||
      keyboardFocusInside() ||
      ownedPortals().some((popup) => popup.matches('[role="menu"], [role="dialog"]'))
    const cancelLeave = () => {
      clearTimeout(leaveTimer)
      leaveTimer = undefined
    }
    const leave = () => {
      // Focus can move while the pointer is still entering (for example, a fast click).
      // Only leaving the hover region cancels its pending expansion.
      if (!inside(pointer)) cancelEnter()
      if (held()) {
        cancelLeave()
        return
      }
      if (leaveTimer) return
      leaveTimer = setTimeout(() => {
        leaveTimer = undefined
        if (!held()) setTemporary(false)
      }, 250)
    }
    const pointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !hover.matches) return
      const wasInside = inside(pointer)
      pointer = event.target as Node
      if (inside(pointer)) {
        cancelLeave()
        if (!wasInside) {
          cancelEnter()
          enterTimer = setTimeout(() => {
            enterTimer = undefined
            if (inside(pointer)) setTemporary(true)
          }, 180)
        }
      } else leave()
    }
    const pointerOut = (event: PointerEvent) => {
      if (event.relatedTarget !== null) return
      pointer = null
      leave()
    }
    const focusIn = () => {
      if (keyboardFocusInside()) {
        cancelLeave()
        cancelEnter()
        setTemporary(true)
      } else if (!held()) leave()
    }
    const pointerDown = (event: PointerEvent) => {
      modality = 'pointer'
      pointer = hover.matches && event.pointerType !== 'touch' ? (event.target as Node) : null
      // A pointer-focused link must not hold the rail after the pointer leaves. Keep the
      // browser's focus in place; a later Tab/arrow key takes over keyboard ownership.
      if (!held()) leave()
    }
    const keyDown = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)
      )
        return
      modality = 'keyboard'
      focusIn()
    }
    const focusOut = () => leave()
    const observer = new MutationObserver(() => {
      if (!held()) leave()
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'aria-controls', 'aria-describedby', 'data-state'],
    })
    document.addEventListener('pointerover', pointerOver)
    document.addEventListener('pointerout', pointerOut)
    document.addEventListener('pointerdown', pointerDown, true)
    document.addEventListener('keydown', keyDown, true)
    document.addEventListener('focusin', focusIn)
    document.addEventListener('focusout', focusOut)
    return () => {
      cancelEnter()
      cancelLeave()
      observer.disconnect()
      document.removeEventListener('pointerover', pointerOver)
      document.removeEventListener('pointerout', pointerOut)
      document.removeEventListener('pointerdown', pointerDown, true)
      document.removeEventListener('keydown', keyDown, true)
      document.removeEventListener('focusin', focusIn)
      document.removeEventListener('focusout', focusOut)
    }
  }, [])

  const togglePin = () => {
    const next = !pinned
    setPinned(next)
    try {
      window.localStorage.setItem(PREFERENCE_KEY, String(!next))
    } catch {
      // Pinning still works for this session.
    }
  }
  return { rail, pinned, expanded: pinned || temporary, togglePin }
}
