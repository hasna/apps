import { describe, expect, test } from 'bun:test'
import { gatewayApiV1Root } from './api-display-url.js'

describe('gatewayApiV1Root (issue #1588)', () => {
  test('resolves the bare gateway form to the /v1 root', () => {
    expect(gatewayApiV1Root('https://api.hasna.com/economy')).toBe('https://api.hasna.com/economy/v1')
    expect(gatewayApiV1Root('https://api.hasna.com/todos')).toBe('https://api.hasna.com/todos/v1')
    expect(gatewayApiV1Root('https://api.hasna.com/economy/')).toBe('https://api.hasna.com/economy/v1')
  })

  test('keeps the already-resolved gateway form unchanged', () => {
    expect(gatewayApiV1Root('https://api.hasna.com/economy/v1')).toBe('https://api.hasna.com/economy/v1')
    expect(gatewayApiV1Root('https://api.hasna.com/economy/v1/')).toBe('https://api.hasna.com/economy/v1')
  })

  test('returns null for non-gateway forms (legacy origins, self-hosted, localhost)', () => {
    expect(gatewayApiV1Root('https://economy.hasna.xyz')).toBeNull()
    expect(gatewayApiV1Root('https://economy.hasna.xyz/v1')).toBeNull()
    expect(gatewayApiV1Root('https://example.com/economy')).toBeNull()
    expect(gatewayApiV1Root('http://127.0.0.1:8080')).toBeNull()
    expect(gatewayApiV1Root('https://api.hasna.com')).toBeNull()
    expect(gatewayApiV1Root('https://api.hasna.com/economy/v1/extra')).toBeNull()
  })

  test('returns null for null, blank and unparseable input', () => {
    expect(gatewayApiV1Root(null)).toBeNull()
    expect(gatewayApiV1Root(undefined)).toBeNull()
    expect(gatewayApiV1Root('')).toBeNull()
    expect(gatewayApiV1Root('   ')).toBeNull()
    expect(gatewayApiV1Root('not a url')).toBeNull()
  })

  test('refuses gateway-form URLs carrying credential material', () => {
    expect(gatewayApiV1Root('https://user:pass@api.hasna.com/economy')).toBeNull()
    expect(gatewayApiV1Root('https://api.hasna.com/economy?token=abc')).toBeNull()
    expect(gatewayApiV1Root('https://api.hasna.com/economy#frag')).toBeNull()
  })
})