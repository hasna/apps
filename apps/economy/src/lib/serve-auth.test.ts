import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { getServeApiToken, getServeBindHost, isAuthorizedRequest, requireServeApiToken } from './serve-auth.js'

describe('serve auth', () => {
  const env = { ...process.env }

  beforeEach(() => {
    delete process.env['ECONOMY_API_TOKEN']
    delete process.env['HASNA_ECONOMY_API_TOKEN']
    delete process.env['ECONOMY_BIND']
    delete process.env['ECONOMY_HOST']
  })

  afterEach(() => {
    process.env = { ...env }
  })

  test('defaults to loopback without token', () => {
    expect(getServeBindHost()).toBe('127.0.0.1')
  })

  test('binds localhost when API token is set', () => {
    process.env['ECONOMY_API_TOKEN'] = 'secret'
    expect(getServeBindHost()).toBe('127.0.0.1')
  })

  test('honors explicit bind overrides', () => {
    process.env['ECONOMY_API_TOKEN'] = 'secret'
    process.env['ECONOMY_BIND'] = '0.0.0.0'
    expect(getServeBindHost()).toBe('0.0.0.0')

    delete process.env['ECONOMY_BIND']
    process.env['ECONOMY_HOST'] = '::1'
    expect(getServeBindHost()).toBe('::1')
  })

  test('requires a configured token before serving API routes', () => {
    const apiReq = new Request('http://localhost/api/summary')
    expect(isAuthorizedRequest(apiReq, '/api/summary')).toBe(false)
    expect(isAuthorizedRequest(apiReq, '/health')).toBe(true)
    expect(() => requireServeApiToken()).toThrow('ECONOMY_API_TOKEN or HASNA_ECONOMY_API_TOKEN is required')
  })

  test('falls back to HASNA_ECONOMY_API_TOKEN when primary token is blank', () => {
    process.env['ECONOMY_API_TOKEN'] = '   '
    process.env['HASNA_ECONOMY_API_TOKEN'] = 'hasna-secret'
    expect(getServeApiToken()).toBe('hasna-secret')
    expect(requireServeApiToken()).toBe('hasna-secret')
  })

  test('requires bearer or economy token when configured', () => {
    process.env['ECONOMY_API_TOKEN'] = 'secret'
    const bearerReq = new Request('http://localhost/api/summary', {
      headers: { Authorization: 'Bearer secret' },
    })
    const headerReq = new Request('http://localhost/api/summary', {
      headers: { 'X-Economy-Token': 'secret' },
    })
    const badReq = new Request('http://localhost/api/summary')
    expect(requireServeApiToken()).toBe('secret')
    expect(isAuthorizedRequest(bearerReq, '/api/summary')).toBe(true)
    expect(isAuthorizedRequest(headerReq, '/api/summary')).toBe(true)
    expect(isAuthorizedRequest(badReq, '/api/summary')).toBe(false)
    expect(isAuthorizedRequest(badReq, '/health')).toBe(true)
  })
})
