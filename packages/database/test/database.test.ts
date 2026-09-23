import { describe, expect, it } from 'vitest'
import { Database, InvalidContextIdError } from '../src'

// Never connects: invalid ids are rejected before any query is issued.
const db = Database.connect({ url: 'postgresql://nobody:nothing@127.0.0.1:1/none' })

describe('Database context guards', () => {
  it('rejects a non-UUID tenant id before touching the database', async () => {
    await expect(db.withTenant("x'; DROP TABLE users; --", async () => 1)).rejects.toBeInstanceOf(
      InvalidContextIdError,
    )
  })

  it('rejects a non-UUID user id', async () => {
    await expect(db.withUser('not-a-uuid', async () => 1)).rejects.toBeInstanceOf(
      InvalidContextIdError,
    )
    await expect(
      db.withTenant('0192a8f0-0000-7000-8000-000000000000', async () => 1, { userId: 'nope' }),
    ).rejects.toBeInstanceOf(InvalidContextIdError)
  })
})
