import type { CliError } from './errors.js'

export const RESULT_SCHEMA = 'hasna.cli_result.v1' as const

export type ResultMeta = {
  command: string
  profile?: string
  durationMs: number
  requestId?: string
  idempotencyKey?: string
}

export type CliResult =
  | { schema: typeof RESULT_SCHEMA; ok: true; data: unknown; meta: ResultMeta }
  | {
      schema: typeof RESULT_SCHEMA
      ok: false
      error: { code: string; message: string; retryable: boolean; details?: unknown }
      meta: ResultMeta
    }

export function success(data: unknown, meta: ResultMeta): CliResult {
  return { schema: RESULT_SCHEMA, ok: true, data, meta }
}

export function failure(error: CliError, meta: ResultMeta): CliResult {
  return {
    schema: RESULT_SCHEMA,
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
    meta,
  }
}
