import { expect, it } from 'vitest'
import { majorToMinor } from '../src/cli/operator-http'
it('financial CLI parses decimals exactly and rejects rounding, negative and unsafe values', () => {
  expect(majorToMinor('0.29')).toBe(29)
  expect(majorToMinor('500')).toBe(50000)
  expect(majorToMinor('12.3')).toBe(1230)
  for (const raw of ['0', '-1', '1.001', 'NaN', '1e3', '9007199254740999'])
    expect(() => majorToMinor(raw)).toThrow()
})
