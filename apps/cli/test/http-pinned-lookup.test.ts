import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

function observed() {
  const root = globalThis as typeof globalThis & {
    __hasnaPinnedLookupTest?: { requestAll: boolean; result: unknown; family: unknown }
  }
  return (root.__hasnaPinnedLookupTest ??= { requestAll: true, result: undefined, family: undefined })
}

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}))

vi.mock('node:https', () => ({
  request: (
    url: URL,
    options: { lookup?: (hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => void },
    onResponse: (response: EventEmitter & { headers: Record<string, string>; statusCode: number; destroy(): void }) => void,
  ) => {
    const request = new EventEmitter() as EventEmitter & { destroy(): void; end(body?: string): void }
    request.destroy = () => undefined
    request.end = () => {
      options.lookup?.(url.hostname, { all: observed().requestAll }, (error, result, family) => {
        if (error) {
          queueMicrotask(() => request.emit('error', error))
          return
        }
        if (observed().requestAll !== Array.isArray(result)) {
          const invalid = Object.assign(new Error('Invalid IP address'), { code: 'ERR_INVALID_IP_ADDRESS' })
          queueMicrotask(() => request.emit('error', invalid))
          return
        }
        observed().result = result
        observed().family = family
        const response = new EventEmitter() as EventEmitter & {
          headers: Record<string, string>
          statusCode: number
          destroy(): void
        }
        response.headers = { 'content-type': 'application/json' }
        response.statusCode = 200
        response.destroy = () => undefined
        queueMicrotask(() => {
          onResponse(response)
          response.emit('data', Buffer.from('{"ok":true,"data":{"compatible":true}}'))
          response.emit('end')
        })
      })
    }
    return request
  },
}))

describe('pinned DNS lookup compatibility', () => {
  it('returns an address array when Node requests lookup options.all', async () => {
    observed().requestAll = true
    const { NodeApiTransport, unwrap } = await import('../src/http.js')
    const response = await new NodeApiTransport('https://example.com').request({ path: '/openapi.json' })
    expect(observed().result).toEqual([{ address: '93.184.216.34', family: 4 }])
    expect(unwrap(response)).toEqual({ compatible: true })
  })

  it('returns a scalar address and family for the single-address signature', async () => {
    observed().requestAll = false
    const { NodeApiTransport } = await import('../src/http.js')
    await new NodeApiTransport('https://example.com').request({ path: '/openapi.json' })
    expect(observed().result).toBe('93.184.216.34')
    expect(observed().family).toBe(4)
  })
})
