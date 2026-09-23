import { describe, expect, it } from 'vitest'
import { UUID_RE, uuidv7 } from '../src/ids'

describe('uuidv7', () => {
  it('produces RFC 9562 version 7 UUIDs', () => {
    const id = uuidv7()
    expect(id).toMatch(UUID_RE)
    expect(id[14]).toBe('7')
    expect(['8', '9', 'a', 'b']).toContain(id[19])
  })

  it('encodes the timestamp in the first 48 bits', () => {
    // Far-future timestamp so earlier calls in this process can't hold lastMs above it.
    const ts = Date.UTC(2099, 0, 1, 0, 0, 0)
    const id = uuidv7(ts)
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(ts)
  })

  it('is strictly increasing when generated in a tight loop', () => {
    const ids = Array.from({ length: 5000 }, () => uuidv7())
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('stays ordered when the clock moves backwards', () => {
    const later = uuidv7(Date.UTC(2100, 0, 1))
    const earlierClock = uuidv7(Date.UTC(2020, 0, 1))
    expect(earlierClock > later).toBe(true)
  })
})
