import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Button } from '../src/components/button'
import { Modal, ModalContent } from '../src/components/modal'

afterEach(cleanup)

/** A controlled dialog opened from an ordinary button (no Radix Trigger), as most screens do. */
function Controlled() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add contact</Button>
      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent title="New contact">
          <input aria-label="Name" autoFocus />
        </ModalContent>
      </Modal>
    </>
  )
}

describe('Modal focus', () => {
  // Regression: focus fell to <body> on close because there was no Trigger to return to.
  it('returns focus to the button that opened it', async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    const opener = screen.getByRole('button', { name: 'Add contact' })
    await user.click(opener)
    expect(await screen.findByRole('dialog', { name: 'New contact' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
  })
})
