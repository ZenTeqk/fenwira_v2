import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MESSAGE_TICKS, MessageTicks, tickStateOf } from '../src/components/message-ticks'

afterEach(cleanup)

describe('MessageTicks', () => {
  it('maps every outbound status to one tick state; inbound shows none', () => {
    expect(['CREATED', 'QUEUED', 'SENDING'].map(tickStateOf)).toEqual([
      'pending',
      'pending',
      'pending',
    ])
    expect(['SENT', 'DELIVERED', 'READ', 'FAILED'].map(tickStateOf)).toEqual([
      'sent',
      'delivered',
      'read',
      'failed',
    ])
    expect(tickStateOf('RECEIVED')).toBeNull()
    const { container } = render(<MessageTicks status="RECEIVED" />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    ['QUEUED', 'Sending', 'text-chat-meta'],
    ['SENT', 'Sent', 'text-chat-meta'],
    ['DELIVERED', 'Delivered', 'text-chat-meta'],
    ['READ', 'Read', 'text-chat-read'],
  ])('%s is an icon named "%s" with a title, no visible text', (status, label, tone) => {
    const { container } = render(<MessageTicks status={status} />)
    const tick = screen.getByRole('img', { name: label })
    expect(tick).toHaveAttribute('title', label)
    expect(tick).toHaveTextContent('')
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveClass(tone)
  })

  it('blue is only ever the read double tick', () => {
    const blue = Object.entries(MESSAGE_TICKS).filter(([, t]) => t.className === 'text-chat-read')
    expect(blue.map(([state]) => state)).toEqual(['read'])
    // Read differs from delivered by stroke weight too, not only colour.
    const { container, rerender } = render(<MessageTicks status="DELIVERED" />)
    const weight = () => container.querySelector('svg')!.getAttribute('stroke-width')
    const delivered = weight()
    rerender(<MessageTicks status="READ" />)
    expect(Number(weight())).toBeGreaterThan(Number(delivered))
  })

  it('failed is a focusable button that shows the reason and code on focus', () => {
    render(
      <MessageTicks
        status="FAILED"
        errorCode="META_131049"
        errorDetail="This message was not delivered to maintain healthy ecosystem engagement."
      />,
    )
    const button = screen.getByRole('button', { name: 'Failed to send' })
    expect(button).toHaveAttribute('title', 'Failed to send')
    expect(button.querySelector('svg')).toHaveClass('text-status-error')
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => button.focus())
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('maintain healthy ecosystem engagement')
    expect(tip).toHaveTextContent('Error code 131049')
    expect(button).toHaveAttribute('aria-describedby', tip.id)
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.click(button)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })

  it('failed without a reason still explains itself', () => {
    render(<MessageTicks status="FAILED" />)
    fireEvent.click(screen.getByRole('button', { name: 'Failed to send' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('WhatsApp did not accept this message.')
  })
})
