import { randomBytes } from 'node:crypto'

let lastMs = 0
let seq = 0

/**
 * RFC 9562 UUIDv7: 48-bit unix-ms timestamp, version 7, 12-bit counter (monotonic within the
 * same millisecond in this process), variant 10, 62 random bits. Time-ordered, see ADR-0017.
 */
export function uuidv7(now: number = Date.now()): string {
  // Never go backwards: a clock step back reuses the last millisecond and keeps counting.
  let ms = Math.max(now, lastMs)
  if (ms === lastMs) {
    seq += 1
    if (seq > 0xfff) {
      ms += 1 // counter exhausted: borrow the next millisecond
      seq = randomStart()
    }
  } else {
    seq = randomStart()
  }
  lastMs = ms

  const bytes = randomBytes(16)
  bytes.writeUIntBE(ms, 0, 6)
  bytes[6] = 0x70 | ((seq >> 8) & 0x0f)
  bytes[7] = seq & 0xff
  bytes[8] = 0x80 | (bytes[8]! & 0x3f)

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function randomStart(): number {
  // Random start leaves >= 3k increments of headroom within one millisecond.
  return randomBytes(2).readUInt16BE(0) & 0x3ff
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
