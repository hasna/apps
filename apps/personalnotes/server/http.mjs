// PersonalNotes self-hosted server — error envelope + small HTTP helpers.
// Wire contract: every non-2xx body is {"error":{code,message,details?}}
// with the code vocabulary of the personalnotes/v1 dialect (§1).

export class ApiError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function errorBody(code, message, details) {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

export function mapError(err) {
  if (err instanceof ApiError) return { code: err.code, message: err.message, status: err.status, details: err.details };
  // SQLite constraint violations map to the same generic 409 the platform
  // produces for Postgres 23505 — required so concurrent duplicate
  // Idempotency-Keys surface as retryable 409 "conflict" (§5.4).
  const code = err?.code ?? '';
  if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
    return { code: 'conflict', message: 'resource already exists', status: 409 };
  }
  return { code: 'internal_error', message: 'internal server error', status: 500 };
}

export function bearer(header) {
  if (!header) return '';
  const [scheme, token] = header.split(/\s+/, 2);
  return /^Bearer$/i.test(scheme ?? '') ? token ?? '' : '';
}

export function parseLimit(value, fallback = 50, max = 200) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}
