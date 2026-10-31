/**
 * Shared focus-visible ring: 2px focus-ring outline (3:1 non-text contrast in both themes).
 * `outline-solid` is required: in Tailwind v4 `outline-none` sets the outline-style variable that
 * `outline-2` reads, so without it the ring never draws.
 */
export const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
