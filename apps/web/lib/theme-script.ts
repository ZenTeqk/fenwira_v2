/**
 * Appearance preference storage and the pre-paint script. Plain module (no 'use client'), so the
 * server layout can inline the script; the client hook lives in `lib/theme.ts`.
 */
export type ThemePreference = 'light' | 'dark' | 'system'
export const THEME_STORAGE_KEY = 'fenwira.theme'
export const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Runs in <head> before first paint (no flash of the wrong theme). Dependency-free and tolerant of
 * blocked storage. A future Content-Security-Policy must allow this inline script (hash or nonce).
 */
export const themeInitScript = `(function(){try{var p=localStorage.getItem('${THEME_STORAGE_KEY}');if(p!=='light'&&p!=='dark')p=matchMedia('${DARK_QUERY}').matches?'dark':'light';document.documentElement.setAttribute('data-theme',p)}catch(e){}})()`
