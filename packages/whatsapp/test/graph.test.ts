import { describe, expect, it } from 'vitest'
import { graphUrl } from '../src'

const config = { baseUrl: 'https://graph.facebook.com', version: 'v23.0' }

describe('graphUrl', () => {
  it('builds versioned URLs', () => {
    expect(graphUrl(config, '/123/messages')).toBe('https://graph.facebook.com/v23.0/123/messages')
    expect(graphUrl({ ...config, baseUrl: 'http://meta-mock:8080/' }, '123')).toBe(
      'http://meta-mock:8080/v23.0/123',
    )
  })

  it('encodes query parameters', () => {
    expect(graphUrl(config, 'debug_token', { input_token: 'a b&c' })).toBe(
      'https://graph.facebook.com/v23.0/debug_token?input_token=a+b%26c',
    )
  })

  it('rejects malformed versions and path traversal', () => {
    expect(() => graphUrl({ ...config, version: '23' }, 'x')).toThrow(/Invalid Graph API version/)
    expect(() => graphUrl(config, '../oauth/access_token')).toThrow(/must not contain/)
  })
})
