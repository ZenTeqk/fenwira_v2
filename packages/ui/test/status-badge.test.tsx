import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusBadge } from '../src/components/status-badge'

afterEach(cleanup)
describe('campaign status semantics', () => {
  it('maps scheduled/running/processing to info', () => {
    const { rerender } = render(<StatusBadge status="RUNNING" />)
    expect(screen.getByText('Running')).toHaveAttribute('data-status', 'RUNNING')
    expect(screen.getByText('Running')).toHaveClass('bg-info-soft')
    rerender(<StatusBadge status="SCHEDULED" />)
    expect(screen.getByText('Scheduled')).toHaveClass('bg-info-soft')
    rerender(<StatusBadge status="PROCESSING" />)
    expect(screen.getByText('Processing')).toHaveClass('bg-info-soft')
  })
  it('keeps paused and low balance warning, failed danger, draft/archived neutral', () => {
    const { rerender } = render(<StatusBadge status="PAUSED" />)
    expect(screen.getByText('Paused')).toHaveClass('bg-warning-soft')
    rerender(<StatusBadge status="PAUSED_INSUFFICIENT_FUNDS" />)
    expect(screen.getByText('Paused: no credits')).toHaveClass('bg-warning-soft')
    rerender(<StatusBadge status="LOW_BALANCE" />)
    expect(screen.getByText('Low balance')).toHaveClass('bg-warning-soft')
    rerender(<StatusBadge status="FAILED" />)
    expect(screen.getByText('Failed')).toHaveClass('bg-danger-soft')
    rerender(<StatusBadge status="DRAFT" />)
    expect(screen.getByText('Draft')).toHaveClass('bg-neutral-soft')
    rerender(<StatusBadge status="ARCHIVED" />)
    expect(screen.getByText('Archived')).toHaveClass('bg-neutral-soft')
  })
  it('tells sent, delivered and read apart by icon, not color alone', () => {
    render(
      <>
        <StatusBadge status="SENT" />
        <StatusBadge status="DELIVERED" />
        <StatusBadge status="READ" />
      </>,
    )
    const icon = (label: string) => screen.getByText(label).querySelector('svg')!
    expect(icon('Sent')).toHaveClass('lucide-check')
    expect(icon('Delivered')).toHaveClass('lucide-check-check')
    expect(icon('Delivered')).toHaveAttribute('stroke-width', '2')
    expect(icon('Read')).toHaveClass('lucide-check-check')
    expect(icon('Read')).toHaveAttribute('stroke-width', '3')
  })
})
