import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { NodeApiTransport, unwrap } from '../src/http.js'
import { EXIT_CODES } from '../src/errors.js'

const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function serverUrl(handler: RequestListener) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

describe('Node API transport', () => {
  it('maps the cweb envelope and preserves request/idempotency headers', async () => {
    let observed = { authorization: '', idempotency: '', body: '' }
    const url = await serverUrl((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        observed = {
          authorization: request.headers.authorization ?? '',
          idempotency: String(request.headers['idempotency-key'] ?? ''),
          body: Buffer.concat(chunks).toString('utf8'),
        }
        response.writeHead(200, { 'Content-Type': 'application/json', 'X-Request-Id': 'api-request' })
        response.end(JSON.stringify({ ok: true, data: { value: 1 } }))
      })
    })
    const transport = new NodeApiTransport(url, 5_000, 30_000, true)
    const response = await transport.request({
      method: 'POST',
      path: '/api/v1/test',
      token: 'bearer-value',
      headers: { 'Idempotency-Key': 'idempotent-1' },
      body: { hello: 'world' },
    })
    expect(unwrap(response)).toEqual({ value: 1 })
    expect(response.requestId).toBe('api-request')
    expect(observed).toEqual({
      authorization: 'Bearer bearer-value',
      idempotency: 'idempotent-1',
      body: '{"hello":"world"}',
    })
  })

  it('maps stable API error status to the global exit contract', async () => {
    const url = await serverUrl((_request, response) => {
      response.writeHead(403, { 'Content-Type': 'application/json', 'X-Request-Id': 'header-request' })
      response.end(JSON.stringify({ ok: false, error: { code: 'CANARY_CODE', message: 'secret-canary', details: { token: 'secret-canary' }, requestId: 'body-request', retryable: false } }))
    })
    await expect(new NodeApiTransport(url, 5_000, 30_000, true).request({ path: '/forbidden' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      exitCode: 4,
      retryable: false,
      requestId: 'body-request',
    })
  })

  it('uses the dedicated timeout exit code', async () => {
    const url = await serverUrl((_request, response) => setTimeout(() => response.end('late'), 100))
    await expect(new NodeApiTransport(url, 100, 10, true).request({ path: '/slow' })).rejects.toMatchObject({
      code: 'TIMEOUT',
      exitCode: 7,
    })
  })

  it('bounds remote response bodies', async () => {
    const url = await serverUrl((_request, response) => response.end('x'.repeat(64)))
    await expect(new NodeApiTransport(url, 100, 100, true, 16).request({ path: '/large' })).rejects.toMatchObject({
      code: 'REMOTE_RESPONSE_TOO_LARGE',
      exitCode: EXIT_CODES.REMOTE,
    })
  })

  it('maps remote preconditions to exit 8 and blocks metadata destinations', async () => {
    const url = await serverUrl((_request, response) => {
      response.writeHead(412, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok: false, error: { message: 'do-not-reflect' } }))
    })
    await expect(new NodeApiTransport(url, 100, 100, true).request({ path: '/precondition' })).rejects.toMatchObject({ exitCode: EXIT_CODES.REMOTE })
    await expect(new NodeApiTransport('https://169.254.169.254').request({ path: '/latest/meta-data' })).rejects.toMatchObject({ code: 'PRIVATE_DESTINATION_BLOCKED' })
  })
})
