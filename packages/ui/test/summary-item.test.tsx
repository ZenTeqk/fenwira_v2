import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SummaryItem } from '../src/components/patterns'

afterEach(cleanup)
describe('SummaryItem', () => {
  // Regression: a long owner email on /platform/workspaces/[id] widened the page at 375 px.
  it('lets long unbroken values wrap inside their column', () => {
    const email = 'lakshmi.narasimha.handloom.owner.account@example-textiles.test'
    render(
      <dl>
        <SummaryItem label="Owner">{email}</SummaryItem>
      </dl>,
    )
    const value = screen.getByText(email)
    expect(value.tagName).toBe('DD')
    expect(value).toHaveClass('min-w-0', 'wrap-anywhere')
  })
})
