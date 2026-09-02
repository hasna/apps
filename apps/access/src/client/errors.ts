import {
  AccessError, ValidationError, NotFoundError, IdentityNotFoundError,
  CredentialNotFoundError, ScopeNotFoundError, ElevationNotFoundError,
  ReviewNotFoundError, TokenNotFoundError, AccessRequestNotFoundError,
  InvalidTransitionError, VersionConflictError, PermissionDeniedError, TokenVerificationError,
} from "../types/index.js";

// Only source-defined codes with their matching HTTP status cross this boundary.
// Messages and suggestions are local constants: remote diagnostics may contain
// credentials, request bodies, SQL errors, or malicious instructions.
const ERRORS = {
  INTERNAL_ERROR: [500, "Access API could not complete the request.", AccessError.suggestion],
  VALIDATION_ERROR: [400, "Access API rejected the input.", ValidationError.suggestion],
  NOT_FOUND: [404, "Access resource not found.", NotFoundError.suggestion],
  IDENTITY_NOT_FOUND: [404, "Identity not found.", IdentityNotFoundError.suggestion],
  CREDENTIAL_NOT_FOUND: [404, "Credential not found.", CredentialNotFoundError.suggestion],
  SCOPE_NOT_FOUND: [404, "Scope grant not found.", ScopeNotFoundError.suggestion],
  ELEVATION_NOT_FOUND: [404, "Elevation not found.", ElevationNotFoundError.suggestion],
  REVIEW_NOT_FOUND: [404, "Access review not found.", ReviewNotFoundError.suggestion],
  TOKEN_NOT_FOUND: [404, "Issued token not found.", TokenNotFoundError.suggestion],
  ACCESS_REQUEST_NOT_FOUND: [404, "Access request not found.", AccessRequestNotFoundError.suggestion],
  INVALID_TRANSITION: [409, "Access resource transition is invalid.", InvalidTransitionError.suggestion],
  VERSION_CONFLICT: [409, "Access resource version conflict.", VersionConflictError.suggestion],
  PERMISSION_DENIED: [403, "Access permission denied.", PermissionDeniedError.suggestion],
  TOKEN_INVALID: [401, "Access token is invalid.", TokenVerificationError.suggestion],
  UNAUTHORIZED: [401, "Access API authentication failed.", "Provide a valid bearer credential."],
  RATE_LIMITED: [429, "Access API rate limit exceeded.", "Slow down and retry."],
} as const;

export class AccessHttpError extends Error {
  readonly code: keyof typeof ERRORS;
  readonly status: number;
  readonly suggestion: string;

  constructor(code: keyof typeof ERRORS) {
    const [status, message, suggestion] = ERRORS[code];
    super(`Access HTTPS request failed (HTTP ${status}). ${message}`);
    this.name = "AccessHttpError";
    this.code = code;
    this.status = status;
    this.suggestion = suggestion;
  }
}

const MAX_ERROR_BYTES = 16 * 1024;
const ERROR_BODY_DEADLINE_MS = 1000;

/** Bounded parsing; never retain or include the response body in an exception. */
export async function readAccessHttpError(response: Response): Promise<Error> {
  const fallback = new Error(`Access HTTPS request failed (HTTP ${response.status}).`);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    reader = response.body?.getReader();
    if (!reader) return fallback;
    const deadlineAt = Date.now() + ERROR_BODY_DEADLINE_MS;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(fallback), ERROR_BODY_DEADLINE_MS);
    });
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    let bytes = 0;
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (Date.now() >= deadlineAt) return fallback;
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_ERROR_BYTES) return fallback;
      text += decoder.decode(value, { stream: true });
    }
    const body: unknown = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== "object" || Array.isArray(body)) return fallback;
    const { code, message, suggestion } = body as Record<string, unknown>;
    // core-app's authentication/input gates omit suggestion; domain errors carry it.
    if (typeof code !== "string" || typeof message !== "string" || (suggestion !== undefined && typeof suggestion !== "string") || !Object.hasOwn(ERRORS, code)) return fallback;
    const knownCode = code as keyof typeof ERRORS;
    if (ERRORS[knownCode][0] !== response.status) return fallback;
    return new AccessHttpError(knownCode);
  } catch {
    return fallback;
  } finally {
    if (timeout) clearTimeout(timeout);
    // Cancellation also bounds oversized streaming bodies. Ignore transport errors.
    if (reader) void reader.cancel().catch(() => {});
  }
}
