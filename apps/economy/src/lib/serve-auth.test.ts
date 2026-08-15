import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { getServeBindHost, isAuthorizedRequest } from './serve-auth.js'

describe('serve auth', () => {
  const env = { ...process.env }

  beforeEach(() => {
    delete process.env['ECONOMY_API_TOKEN']
    delete process.env['ECONOMY_BIND']
  })

  afterEach(() => {
    process.env = { ...env }
  })

  test('defaults to all interfaces without token', () => {
    expect(getServeBindHost()).toBe('0.0.0.0')
  })

  test('binds localhost when API token is set', () => {
    process.env['ECONOMY_API_TOKEN'] = 'secret'
    expect(getServeBindHost()).toBe('127.0.0.1')
  })

  test('honors ECONOMY_BIND override', () => {
    process.env['ECONOMY_API_TOKEN'] = 'secret'
    process.env['ECONOMY_BIND'] = '0.0.0.0'
    expect(getServeBindHost()).toBe('0.0.0.0')
  })

  test('requires bearer token when configured', () => {
    process.env['ECONOMY_API_TOKEN'] = 'secret'
    const okReq = new Request('http://localhost/api/summary', {
      headers: { Authorization: 'Bearer secret' },
    })
    const badReq = new Request('http://localhost/api/summary')
    expect(isAuthorizedRequest(okReq, '/api/summary')).toBe(true)
    expect(isAuthorizedRequest(badReq, '/api/summary')).toBe(false)
    expect(isAuthorizedRequest(badReq, '/health')).toBe(true)
  })
})
