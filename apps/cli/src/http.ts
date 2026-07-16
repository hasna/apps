import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { CliError, EXIT_CODES } from './errors.js'

export type HttpResponse = {
  status: number
  headers: Record<string, string>
  body: unknown
  text: string
  requestId?: string
}

export type HttpRequestOptions = {
  method?: string
  path: string
  query?: Record<string, string | number | undefined>
  token?: string
  body?: unknown
  headers?: Record<string, string>
  accept?: string
}

export interface ApiTransport {
  request(options: HttpRequestOptions): Promise<HttpResponse>
}

export class NodeApiTransport implements ApiTransport {
  constructor(
    private readonly apiUrl: string,
    private readonly connectTimeoutMs = 5_000,
    private readonly requestTimeoutMs = 30_000,
  ) {}

  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const url = new URL(options.path, `${this.apiUrl}/`)
    for (const [key, value] of Object.entries(options.query ?? {}))
      if (value !== undefined) url.searchParams.set(key, String(value))
    const encoded = options.body === undefined ? undefined : JSON.stringify(options.body)
    const requestId = randomUUID()
    const headers: Record<string, string> = {
      Accept: options.accept ?? 'application/json',
      'User-Agent': '@hasna/cli/0.2.0',
      'X-Request-Id': requestId,
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(encoded)) } : {}),
      ...options.headers,
    }
    const perform = url.protocol === 'https:' ? httpsRequest : httpRequest
    return new Promise((resolve, reject) => {
      let connected = false
      const request = perform(url, { method: options.method ?? 'GET', headers }, (response) => {
        connected = true
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          clearTimeout(overall)
          const text = Buffer.concat(chunks).toString('utf8')
          const responseHeaders = Object.fromEntries(
            Object.entries(response.headers).map(([key, value]) => [
              key,
              Array.isArray(value) ? value.join(', ') : (value ?? ''),
            ]),
          )
          let body: unknown = text
          if ((response.headers['content-type'] ?? '').includes('json') && text) {
            try {
              body = JSON.parse(text)
            } catch {
              reject(new CliError('RESPONSE_INVALID', 'The API returned invalid JSON', EXIT_CODES.NETWORK))
              return
            }
          }
          const result: HttpResponse = {
            status: response.statusCode ?? 0,
            headers: responseHeaders,
            body,
            text,
            requestId: responseHeaders['x-request-id'] || requestId,
          }
          if ((response.statusCode ?? 0) >= 400) reject(apiError(result))
          else resolve(result)
        })
      })
      request.once('socket', (socket) => {
        const connectTimer = setTimeout(() => {
          if (!connected) request.destroy(new Error('connect timeout'))
        }, this.connectTimeoutMs)
        socket.once('connect', () => clearTimeout(connectTimer))
        socket.once('secureConnect', () => clearTimeout(connectTimer))
      })
      request.on('error', (error) => {
        clearTimeout(overall)
        const timeout = error.message.includes('timeout')
        reject(
          new CliError(
            timeout ? 'TIMEOUT' : 'NETWORK_ERROR',
            timeout ? 'The API request timed out' : 'The API request failed',
            timeout ? EXIT_CODES.TIMEOUT : EXIT_CODES.NETWORK,
            { cause: error, retryable: true },
          ),
        )
      })
      const overall = setTimeout(() => request.destroy(new Error('request timeout')), this.requestTimeoutMs)
      request.end(encoded)
    })
  }
}

function apiError(response: HttpResponse): CliError {
  const envelope = response.body as {
    error?: { code?: string; message?: string; retryable?: boolean; details?: unknown }
  }
  const exit =
    response.status === 401
      ? EXIT_CODES.AUTH
      : response.status === 403
        ? EXIT_CODES.FORBIDDEN
        : response.status === 404
          ? EXIT_CODES.NOT_FOUND
          : response.status === 409 || response.status === 412
            ? EXIT_CODES.CONFLICT
            : response.status === 400 || response.status === 422 || response.status === 428
              ? EXIT_CODES.VALIDATION
              : response.status === 429 || response.status >= 500
                ? EXIT_CODES.NETWORK
                : EXIT_CODES.INTERNAL
  return new CliError(
    envelope.error?.code || `HTTP_${response.status}`,
    envelope.error?.message || `The API returned HTTP ${response.status}`,
    exit,
    {
      details: envelope.error?.details,
      retryable: envelope.error?.retryable ?? (response.status === 429 || response.status >= 500),
    },
  )
}

export function unwrap(response: HttpResponse): unknown {
  const body = response.body as { ok?: boolean; data?: unknown }
  return body && typeof body === 'object' && body.ok === true ? body.data : response.body
}
