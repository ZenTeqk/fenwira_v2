import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusBadge } from '../src/components/status-badge'

afterEach(cleanup)
describe('campaign status semantics', () => {
  it('preserves the actual running status while using a successful campaign tone', () => {
    const { rerender } = render(<StatusBadge status="RUNNING" context="campaign" />)
    expect(screen.getByText('Running')).toHaveAttribute('data-status', 'RUNNING')
    expect(screen.getByText('Running')).toHaveClass('bg-success-soft')
    rerender(<StatusBadge status="RUNNING" />)
    expect(screen.getByText('Running')).toHaveClass('bg-info-soft')
  })
  it('keeps scheduled, paused and failed status meanings in campaign context', () => {
    const { rerender } = render(<StatusBadge status="SCHEDULED" context="campaign" />)
    expect(screen.getByText('Scheduled')).toHaveClass('bg-info-soft')
    rerender(<StatusBadge status="PAUSED" context="campaign" />)
    expect(screen.getByText('Paused')).toHaveClass('bg-warning-soft')
    rerender(<StatusBadge status="FAILED" context="campaign" />)
    expect(screen.getByText('Failed')).toHaveClass('bg-danger-soft')
  })
})
