// Shared error normalization so CLI, MCP, and /v1 emit an IDENTICAL error
// envelope `{ code, message, suggestion }` (interface-parity, BUILD-SPEC §7).

export interface ErrorEnvelope {
  code: string;
  message: string;
  suggestion: string;
}

export function normalizeError(error: unknown): ErrorEnvelope {
  if (error instanceof Error) {
    const code =
      "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "INTERNAL_ERROR";
    const ctor = error.constructor as unknown as { suggestion?: unknown };
    const suggestion = typeof ctor.suggestion === "string" ? ctor.suggestion : "";
    return { code, message: error.message, suggestion };
  }
  return { code: "UNKNOWN_ERROR", message: String(error), suggestion: "An unexpected error occurred." };
}

const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHORIZED: 401,
  PERMISSION_DENIED: 403,
  ENTITY_NOT_FOUND: 404,
  SWEEP_NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  INVALID_LIST_QUERY: 400,
  RATE_LIMITED: 429,
};

export function httpStatusForCode(code: string): number {
  return STATUS_BY_CODE[code] ?? 500;
}
