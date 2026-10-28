import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhoneFrame } from '../src/components/phone-frame'

afterEach(() => vi.restoreAllMocks())

describe('PhoneFrame scroll behavior', () => {
  it.each([false, true])(
    'scrolls only for newly added messages (reduced motion: %s)',
    (reduced) => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduced } as MediaQueryList)
      const scroll = vi.fn()
      const { rerender } = render(
        <PhoneFrame messageCount={1}>
          <p>Short message</p>
        </PhoneFrame>,
      )
      const region = screen.getByRole('region', { name: 'Preview conversation messages' })
      region.scrollTo = scroll
      Object.defineProperty(region, 'scrollHeight', { value: 1200 })
      region.scrollTop = 50
      rerender(
        <PhoneFrame messageCount={1}>
          <p>Edited message</p>
        </PhoneFrame>,
      )
      expect(scroll).not.toHaveBeenCalled()
      expect(region.scrollTop).toBe(50)
      rerender(
        <PhoneFrame messageCount={2}>
          <p>Edited message</p>
          <p>New message</p>
        </PhoneFrame>,
      )
      expect(scroll).toHaveBeenCalledExactlyOnceWith({
        top: 1200,
        behavior: reduced ? 'instant' : 'smooth',
      })
      rerender(
        <PhoneFrame messageCount={1}>
          <p>Edited message</p>
        </PhoneFrame>,
      )
      expect(scroll).toHaveBeenCalledTimes(1)
      expect(region).toHaveAttribute('tabindex', '0')
    },
  )
})
