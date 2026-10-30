import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusBadge } from '../src/components/status-badge'

afterEach(cleanup)
describe('campaign status semantics', () => {
  it('maps scheduled/running/processing to info', () => {
    const { rerender } = render(<StatusBadge status="RUNNING" />)
    expect(screen.getByText('Running')).toHaveAttribute('data-status', 'RUNNING')
    expect(screen.getByText('Running')).toHaveClass('bg-status-info-bg')
    rerender(<StatusBadge status="SCHEDULED" />)
    expect(screen.getByText('Scheduled')).toHaveClass('bg-status-info-bg')
    rerender(<StatusBadge status="PROCESSING" />)
    expect(screen.getByText('Processing')).toHaveClass('bg-status-info-bg')
  })
  it('keeps paused and low balance warning, failed danger, draft/archived neutral', () => {
    const { rerender } = render(<StatusBadge status="PAUSED" />)
    expect(screen.getByText('Paused')).toHaveClass('bg-status-warning-bg')
    rerender(<StatusBadge status="PAUSED_INSUFFICIENT_FUNDS" />)
    expect(screen.getByText('Paused: no credits')).toHaveClass('bg-status-warning-bg')
    rerender(<StatusBadge status="LOW_BALANCE" />)
    expect(screen.getByText('Low balance')).toHaveClass('bg-status-warning-bg')
    rerender(<StatusBadge status="FAILED" />)
    expect(screen.getByText('Failed')).toHaveClass('bg-status-error-bg')
    rerender(<StatusBadge status="DRAFT" />)
    expect(screen.getByText('Draft')).toHaveClass('bg-surface-muted')
    rerender(<StatusBadge status="ARCHIVED" />)
    expect(screen.getByText('Archived')).toHaveClass('bg-surface-muted')
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
