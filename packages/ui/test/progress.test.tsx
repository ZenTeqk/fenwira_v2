import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Progress } from '../src/components/progress'

afterEach(cleanup)
describe('named native progress', () => {
  it('exposes the actual count and denominator to assistive technology', () => {
    render(<Progress label="Order updates sent" value={4} max={10} />)
    const progress = screen.getByRole('progressbar', { name: 'Order updates sent' })
    expect(progress).toHaveAttribute('value', '4')
    expect(progress).toHaveAttribute('max', '10')
  })
  it('keeps invalid and out-of-range input within finite native bounds', () => {
    const { rerender } = render(<Progress label="Sent" value={NaN} max={0} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0')
    expect(screen.getByRole('progressbar')).toHaveAttribute('max', '1')
    rerender(<Progress label="Sent" value={14} max={10} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '10')
  })
})
