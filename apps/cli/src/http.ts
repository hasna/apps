import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP, type LookupFunction } from 'node:net'
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
    private readonly allowPrivateDestination = false,
    private readonly maxResponseBytes = 10 * 1024 * 1024,
  ) {}

  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const base = new URL(`${this.apiUrl}/`)
    const url = new URL(options.path, base)
    if (url.origin !== base.origin)
      throw new CliError('CROSS_ORIGIN_REQUEST_BLOCKED', 'Cross-origin API requests are blocked', EXIT_CODES.USAGE)
    if (base.username || base.password || base.hash || url.username || url.password || url.hash)
      throw new CliError('API_URL_UNSAFE', 'The API URL cannot contain credentials or fragments', EXIT_CODES.USAGE)
    if (url.protocol !== 'https:' && !(this.allowPrivateDestination && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)))
      throw new CliError('API_URL_UNSAFE', 'API requests require HTTPS except explicitly opted-in localhost', EXIT_CODES.USAGE)
    for (const [key, value] of Object.entries(options.query ?? {}))
      if (value !== undefined) url.searchParams.set(key, String(value))
    const encoded = options.body === undefined ? undefined : JSON.stringify(options.body)
    const resolved = this.allowPrivateDestination ? undefined : await resolvePublicDestination(url.hostname)
    const requestId = randomUUID()
    const headers: Record<string, string> = {
      ...options.headers,
      Accept: options.accept ?? 'application/json',
      'User-Agent': '@hasna/cli/0.2.0',
      'X-Request-Id': requestId,
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(encoded)) } : {}),
    }
    const perform = url.protocol === 'https:' ? httpsRequest : httpRequest
    return new Promise((resolve, reject) => {
      let connected = false
      let settled = false
      let connectTimer: NodeJS.Timeout | undefined
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(overall)
        if (connectTimer) clearTimeout(connectTimer)
        callback()
      }
      const pinnedLookup: LookupFunction | undefined = resolved
        ? (_hostname, _options, callback) => callback(null, resolved.address, resolved.family)
        : undefined
      const request = perform(url, { method: options.method ?? 'GET', headers, ...(pinnedLookup ? { lookup: pinnedLookup } : {}) }, (response) => {
        connected = true
        const chunks: Buffer[] = []
        let bytes = 0
        response.on('data', (chunk) => {
          bytes += Buffer.byteLength(chunk)
          if (bytes > this.maxResponseBytes) {
            finish(() => reject(new CliError('REMOTE_RESPONSE_TOO_LARGE', 'The API response exceeded the safe size limit', EXIT_CODES.REMOTE)))
            request.destroy()
            response.destroy()
            return
          }
          chunks.push(Buffer.from(chunk))
        })
        response.once('aborted', () => finish(() => reject(new CliError('REMOTE_RESPONSE_ABORTED', 'The API response was interrupted', EXIT_CODES.REMOTE, { retryable: true }))))
        response.once('error', (error) => finish(() => reject(new CliError(
          'REMOTE_RESPONSE_INVALID',
          'The API response was invalid',
          EXIT_CODES.REMOTE,
          { cause: error },
        ))))
        response.on('end', () => {
          if (settled) return
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
              finish(() => reject(new CliError('REMOTE_RESPONSE_INVALID', 'The API returned malformed JSON', EXIT_CODES.REMOTE, {
                requestId: safeRequestId(responseHeaders['x-request-id']) || requestId,
              })))
              return
            }
          }
          const result: HttpResponse = {
            status: response.statusCode ?? 0,
            headers: responseHeaders,
            body,
            text,
            requestId: safeRequestId(responseHeaders['x-request-id']) || requestId,
          }
          finish(() => {
            if ((response.statusCode ?? 0) >= 300) reject(apiError(result))
            else resolve(result)
          })
        })
      })
      request.once('socket', (socket) => {
        if (!socket.connecting) {
          connected = true
          return
        }
        connectTimer = setTimeout(() => {
          if (!connected) {
            finish(() => reject(timeoutError()))
            request.destroy()
          }
        }, this.connectTimeoutMs)
        socket.once('connect', () => connectTimer && clearTimeout(connectTimer))
        socket.once('secureConnect', () => connectTimer && clearTimeout(connectTimer))
      })
      request.on('error', (error) => {
        const timeout = error.message.includes('timeout')
        finish(() => reject(
          new CliError(
            timeout ? 'TIMEOUT' : 'NETWORK_ERROR',
            timeout ? 'The API request timed out' : 'The API request failed',
            EXIT_CODES.NETWORK,
            { cause: error, retryable: true },
          ),
        ))
      })
      const overall = setTimeout(() => {
        finish(() => reject(timeoutError()))
        request.destroy()
      }, this.requestTimeoutMs)
      request.end(encoded)
    })
  }
}

function timeoutError(): CliError {
  return new CliError('TIMEOUT', 'The API request timed out', EXIT_CODES.NETWORK, { retryable: true })
}

function apiError(response: HttpResponse): CliError {
  const envelope = (response.body && typeof response.body === 'object' ? response.body : {}) as {
    error?: { requestId?: string; retryable?: boolean }
  }
  const exit =
    response.status === 401
      ? EXIT_CODES.AUTH
      : response.status === 403
        ? EXIT_CODES.FORBIDDEN
        : response.status === 404 || response.status === 410
          ? EXIT_CODES.NOT_FOUND
          : response.status === 409
            ? EXIT_CODES.CONFLICT
            : EXIT_CODES.REMOTE
  const code = response.status === 401 ? 'AUTHENTICATION_FAILED'
    : response.status === 403 ? 'PERMISSION_DENIED'
      : response.status === 404 || response.status === 410 ? 'RESOURCE_NOT_FOUND'
        : response.status === 409 ? 'CONFLICT'
          : response.status === 400 || response.status === 422 ? 'REMOTE_VALIDATION_FAILED'
          : response.status === 412 ? 'REMOTE_PRECONDITION_FAILED'
          : response.status === 413 ? 'REMOTE_REQUEST_TOO_LARGE'
          : response.status >= 300 && response.status < 400 ? 'REMOTE_REDIRECT_REJECTED'
          : response.status === 429 ? 'REMOTE_RATE_LIMITED'
            : response.status >= 500 ? 'REMOTE_SERVER_ERROR'
              : 'REMOTE_REQUEST_REJECTED'
  return new CliError(
    code,
    `The API rejected the request (HTTP ${response.status})`,
    exit,
    {
      retryable: typeof envelope.error?.retryable === 'boolean' ? envelope.error.retryable : (response.status === 429 || response.status >= 500),
      requestId: safeRequestId(envelope.error?.requestId) || response.requestId,
    },
  )
}

function safeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined
}

async function resolvePublicDestination(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (normalized === 'localhost' || normalized.endsWith('.localhost'))
    throw new CliError('PRIVATE_DESTINATION_BLOCKED', 'Credentialed requests to private destinations are blocked', EXIT_CODES.USAGE)
  let addresses: Array<{ address: string; family: number }>
  try {
    const family = isIP(normalized)
    addresses = family ? [{ address: normalized, family }] : await lookup(normalized, { all: true })
  } catch (error) {
    throw new CliError('NETWORK_ERROR', 'The API destination could not be resolved', EXIT_CODES.NETWORK, { cause: error, retryable: true })
  }
  if (addresses.some(({ address }) => isPrivateAddress(address)))
    throw new CliError('PRIVATE_DESTINATION_BLOCKED', 'Credentialed requests to private destinations are blocked', EXIT_CODES.USAGE)
  const selected = addresses[0]
  if (!selected || (selected.family !== 4 && selected.family !== 6))
    throw new CliError('NETWORK_ERROR', 'The API destination could not be resolved', EXIT_CODES.NETWORK, { retryable: true })
  return { address: selected.address, family: selected.family }
}

function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase()
  if (value.startsWith('::ffff:')) return true
  if (value.includes(':'))
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('fec') || value.startsWith('fed') || value.startsWith('fee') || value.startsWith('fef') || value.startsWith('ff') || value.startsWith('2001:db8:')
  const parts = value.split('.').map(Number)
  const first = parts[0] ?? -1
  const second = parts[1] ?? -1
  const third = parts[2] ?? -1
  const fourth = parts[3] ?? -1
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224 ||
    (first === 255 && second === 255 && third === 255 && fourth === 255)
}

export function unwrap(response: HttpResponse): unknown {
  const body = response.body as { ok?: boolean; data?: unknown }
  return body && typeof body === 'object' && body.ok === true ? body.data : response.body
}
