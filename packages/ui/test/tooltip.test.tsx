import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Button } from '../src/components/button'
import { Tooltip, TooltipProvider } from '../src/components/tooltip'

afterEach(cleanup)

const Hint = () => (
  <TooltipProvider delayDuration={0}>
    <Tooltip content="Inbox">
      <Button>Go</Button>
    </Tooltip>
  </TooltipProvider>
)

describe('Tooltip', () => {
  it('opens on focus', async () => {
    render(<Hint />)
    await userEvent.tab()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Inbox')
  })
})
