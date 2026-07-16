export const EXIT_CODES = {
  SUCCESS: 0,
  USAGE: 2,
  CONFIG: 2,
  VALIDATION: 2,
  AUTH: 3,
  FORBIDDEN: 4,
  NOT_FOUND: 5,
  CONFLICT: 6,
  NETWORK: 7,
  TIMEOUT: 7,
  REMOTE: 8,
  PARTIAL: 9,
  CANCELLED: 10,
  UNSUPPORTED: 11,
  INTERNAL: 70,
} as const

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES]

export class CliError extends Error {
  readonly code: string
  readonly exitCode: ExitCode
  readonly details?: unknown
  readonly retryable: boolean
  readonly requestId?: string

  constructor(
    code: string,
    message: string,
    exitCode: ExitCode,
    options: { details?: unknown; retryable?: boolean; requestId?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'CliError'
    this.code = code
    this.exitCode = exitCode
    this.details = options.details
    this.retryable = options.retryable ?? false
    this.requestId = options.requestId
  }
}

export function asCliError(error: unknown): CliError {
  if (error instanceof CliError) return error
  if (error instanceof Error && error.name === 'AbortError')
    return new CliError('TIMEOUT', 'The request timed out', EXIT_CODES.TIMEOUT, {
      retryable: true,
      cause: error,
    })
  return new CliError('INTERNAL_ERROR', 'An unexpected error occurred', EXIT_CODES.INTERNAL, {
    cause: error,
  })
}
