import { type WhatsAppConnection } from '@fenwira/contracts'
import { describe, expect, it } from 'vitest'
import { connectionHealth } from '@/lib/workspace-status'

const n = (status: WhatsAppConnection['status']) => ({ status }) as WhatsAppConnection

describe('connectionHealth (header WhatsApp indicator)', () => {
  it('never treats missing, loading or failed data as connected', () => {
    expect(connectionHealth(undefined, true, false)).toEqual({
      health: 'checking',
      label: 'Checking…',
    })
    expect(connectionHealth(undefined, false, false).health).toBe('unavailable')
    expect(connectionHealth(undefined, false, true).health).toBe('unavailable')
    // A failed refresh over older cached "connected" data is unavailable, not connected.
    expect(connectionHealth([n('CONNECTED')], false, true)).toEqual({
      health: 'unavailable',
      label: 'Status unavailable',
    })
  })
  it('maps one number to connected, disconnected or attention', () => {
    expect(connectionHealth([], false, false)).toEqual({
      health: 'disconnected',
      label: 'Not connected',
    })
    expect(connectionHealth([n('CONNECTED')], false, false)).toEqual({
      health: 'connected',
      label: 'Connected',
    })
    for (const [s, label] of [
      ['ERROR', 'Error'],
      ['DISCONNECTED', 'Disconnected'],
      ['RESTRICTED', 'Restricted'],
    ] as const)
      expect(connectionHealth([n(s)], false, false)).toEqual({ health: 'disconnected', label })
    expect(connectionHealth([n('FLAGGED')], false, false)).toEqual({
      health: 'attention',
      label: 'Needs attention',
    })
    expect(connectionHealth([n('PENDING')], false, false)).toEqual({
      health: 'attention',
      label: 'Setup pending',
    })
  })
  it('aggregates several numbers by the worst state, with accurate counts', () => {
    expect(connectionHealth([n('CONNECTED'), n('CONNECTED')], false, false)).toEqual({
      health: 'connected',
      label: '2 numbers connected',
    })
    expect(connectionHealth([n('CONNECTED'), n('FLAGGED')], false, false)).toEqual({
      health: 'attention',
      label: '1 of 2 numbers need attention',
    })
    expect(connectionHealth([n('FLAGGED'), n('ERROR'), n('CONNECTED')], false, false)).toEqual({
      health: 'disconnected',
      label: '1 of 3 numbers not connected',
    })
  })
})
