'use client'

import { useCallback, useEffect, useState } from 'react'

import { DARK_QUERY, THEME_STORAGE_KEY, type ThemePreference } from './theme-script'

/**
 * Appearance preference (Light, Dark or System). The resolved theme is `data-theme` on <html>,
 * set before first paint by `themeInitScript`; tokens.css switches every semantic token under
 * `[data-theme='dark']`, and portaled overlays render inside <html>, so they follow it too. No
 * stored preference means System.
 */
export type { ThemePreference }
export const THEME_PREFERENCES: ThemePreference[] = ['light', 'dark', 'system']

const readPreference = (): ThemePreference => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

const resolve = (preference: ThemePreference) =>
  preference === 'system' ? (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light') : preference

/** Apply without animating every colour: transitions are off for one frame while tokens swap. */
function applyTheme(theme: 'light' | 'dark') {
  const root = document.documentElement
  if (root.getAttribute('data-theme') === theme) return
  const style = document.createElement('style')
  style.textContent = '*,*::before,*::after{transition:none!important}'
  document.head.appendChild(style)
  root.setAttribute('data-theme', theme)
  void root.offsetHeight // commit the new colours before transitions return
  requestAnimationFrame(() => style.remove())
}

/** The stored preference and a setter; follows the OS only while the preference is System. */
export function useThemePreference() {
  // Unknown until mounted (server and first client render agree); the pre-paint script has already
  // applied the right theme, so nothing is re-applied before the stored value is read.
  const [preference, setPreferenceState] = useState<ThemePreference | null>(null)

  useEffect(() => {
    setPreferenceState(readPreference())
    const sync = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
      const next = readPreference()
      setPreferenceState(next)
      applyTheme(resolve(next))
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  useEffect(() => {
    if (preference !== 'system') return
    const media = window.matchMedia(DARK_QUERY)
    const follow = () => applyTheme(media.matches ? 'dark' : 'light')
    follow()
    media.addEventListener('change', follow)
    return () => media.removeEventListener('change', follow)
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
      else window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Storage unavailable: the choice still applies for this page.
    }
    setPreferenceState(next)
    applyTheme(resolve(next))
  }, [])

  return { preference, setPreference }
}
