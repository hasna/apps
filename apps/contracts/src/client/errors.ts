// Client resolution error taxonomy for the Hasna Service Contract v1.
//
// Every failure a hosted client can hit before or at its authority carries ONE
// discriminated `code` and ONE stable process exit code, so an adopter's CLI
// prints `<app>: <CODE>: <message> <remedy>` and exits the same way fleet-wide,
// and a black-box probe can assert on the code without parsing prose.
//
// The 1.0.x classes (`CredentialResolutionError`, `CredentialFileUnsafeError`,
// `ClientTransportConfigurationError`) remain — as SUBCLASSES of
// `ClientResolutionError` with byte-stable messages — so a consumer matching on
// them keeps working while a new consumer switches on `code`.
//
// SAFETY: nothing here ever carries a credential value. `sources` are env key
// NAMES, absolute file PATHS, or Keychain item REFERENCES; `toJSON()` emits the
// same fields and nothing else.

/** The discriminated failure codes, in the order they are documented. */
export const CLIENT_RESOLUTION_CODES = [
  /** Every credential tier was genuinely absent and the local opt-in is off. */
  "CREDENTIAL_ABSENT",
  /** A tier EXISTS but cannot be read or is unusable (locked Keychain, unsafe file, blank declared variable, unreachable vault pointer). */
  "CREDENTIAL_UNREADABLE",
  /** The authority answered 401 or 403; never retried, body discarded. */
  "CREDENTIAL_REJECTED",
  /** No authority could be determined: nothing configured one and the fleet gateway default cannot be composed. */
  "AUTHORITY_MISSING",
  /** A declared authority is unusable: blank, control characters, non-canonical, plain http off loopback, query/fragment/userinfo. */
  "AUTHORITY_INVALID",
  /** Two configured authorities disagree, or the authority changed between snapshot and dispatch. */
  "AUTHORITY_CONFLICT",
  /** `HASNA_<APP>_LOCAL` selects the on-box store while hosted client configuration is also declared, or a hosted client was requested under it. */
  "LOCAL_OPT_IN_CONFLICT",
  /** The authority could not be reached: network failure, timeout, or a retryable status after retries. */
  "TRANSPORT_UNAVAILABLE",
  /** The command is server-only and is not available through the hosted client. */
  "NOT_AVAILABLE_HOSTED",
] as const;
export type ClientResolutionCode = (typeof CLIENT_RESOLUTION_CODES)[number];

/**
 * The process exit code for each failure code. Stable: a change here is a
 * breaking change for every adopter's CLI contract and every black-box probe.
 */
export const CLIENT_RESOLUTION_EXIT_CODES: Readonly<Record<ClientResolutionCode, number>> = Object.freeze({
  CREDENTIAL_ABSENT: 2,
  CREDENTIAL_UNREADABLE: 3,
  CREDENTIAL_REJECTED: 4,
  AUTHORITY_MISSING: 5,
  AUTHORITY_INVALID: 5,
  AUTHORITY_CONFLICT: 5,
  LOCAL_OPT_IN_CONFLICT: 6,
  TRANSPORT_UNAVAILABLE: 7,
  NOT_AVAILABLE_HOSTED: 8,
});

/** One-line, value-free descriptions for `status` / `doctor` output and docs. */
export const CLIENT_RESOLUTION_CODE_DESCRIPTIONS: Readonly<Record<ClientResolutionCode, string>> = Object.freeze({
  CREDENTIAL_ABSENT: "no credential in the Keychain, the credentials file, or the environment, and the local opt-in is off",
  CREDENTIAL_UNREADABLE: "a credential source exists but cannot be read or holds an unusable value",
  CREDENTIAL_REJECTED: "the authority rejected the presented credential (401/403)",
  AUTHORITY_MISSING: "no service authority is configured and the fleet gateway default cannot be composed",
  AUTHORITY_INVALID: "a declared service authority is not a usable HTTPS URL",
  AUTHORITY_CONFLICT: "configured service authorities disagree or changed during a request",
  LOCAL_OPT_IN_CONFLICT: "the local opt-in and hosted client configuration were both declared",
  TRANSPORT_UNAVAILABLE: "the service authority could not be reached",
  NOT_AVAILABLE_HOSTED: "the command is server-only and has no hosted client path",
});

export function isClientResolutionCode(value: unknown): value is ClientResolutionCode {
  return typeof value === "string" && (CLIENT_RESOLUTION_CODES as readonly string[]).includes(value);
}

/** The exit code for a code. */
export function exitCodeForClientResolutionCode(code: ClientResolutionCode): number {
  return CLIENT_RESOLUTION_EXIT_CODES[code];
}

export interface ClientResolutionErrorOptions {
  /** Env key NAMES, absolute PATHS, or Keychain item REFERENCES. Never values. */
  sources?: readonly string[];
  /** What a human should do. Never contains a value. */
  remedy?: string | null;
  cause?: unknown;
}

/** The serialisable envelope. Emitted by `toJSON()`; never carries a value. */
export interface ClientResolutionErrorJson {
  name: string;
  code: ClientResolutionCode;
  exitCode: number;
  app: string | null;
  message: string;
  sources: string[];
  remedy: string | null;
}

/**
 * The base of every client-side resolution failure.
 *
 * Thrown rather than resolved around: a client that cannot prove which
 * principal it acts as, or which authority it talks to, sends nothing and
 * opens no store.
 */
export class ClientResolutionError extends Error {
  readonly code: ClientResolutionCode;
  readonly exitCode: number;
  readonly app: string | null;
  readonly sources: readonly string[];
  readonly remedy: string | null;

  constructor(code: ClientResolutionCode, app: string | null, message: string, options: ClientResolutionErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    if (!isClientResolutionCode(code)) {
      throw new TypeError(`Unknown client resolution code: ${String(code)}`);
    }
    this.name = "ClientResolutionError";
    this.code = code;
    this.exitCode = CLIENT_RESOLUTION_EXIT_CODES[code];
    this.app = app;
    this.sources = Object.freeze([...(options.sources ?? [])]);
    this.remedy = options.remedy ?? null;
  }

  toJSON(): ClientResolutionErrorJson {
    return {
      name: this.name,
      code: this.code,
      exitCode: this.exitCode,
      app: this.app,
      message: this.message,
      sources: [...this.sources],
      remedy: this.remedy,
    };
  }
}

export function isClientResolutionError(value: unknown): value is ClientResolutionError {
  return value instanceof ClientResolutionError;
}

/**
 * The failure code carried by ANY error this package throws, or null.
 *
 * Duck-typed on purpose: `HasnaHttpError` is not a resolution error but
 * carries a `code` for 401/403 and retryable statuses, and a consumer bundling
 * two copies of this package must still classify the other copy's errors.
 */
export function clientResolutionCodeOf(error: unknown): ClientResolutionCode | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return isClientResolutionCode(code) ? code : null;
}

/** The exit code an adopter CLI should use for `error`; `fallback` when it is not ours. */
export function clientResolutionExitCode(error: unknown, fallback = 1): number {
  const code = clientResolutionCodeOf(error);
  return code ? CLIENT_RESOLUTION_EXIT_CODES[code] : fallback;
}

export interface FormatClientResolutionFailureOptions {
  /** App slug to prefix the line with; defaults to the error's own `app`. */
  app?: string | null;
  /** Emit the `toJSON()` envelope instead of the one-line text. */
  json?: boolean;
}

/**
 * The one line an adopter CLI prints to STDERR before exiting with
 * {@link clientResolutionExitCode}: `<app>: <CODE>: <message> <remedy>`.
 * With `json`, the `toJSON()` envelope (still for stderr, never stdout).
 */
export function formatClientResolutionFailure(
  error: ClientResolutionError,
  options: FormatClientResolutionFailureOptions = {},
): string {
  const app = options.app ?? error.app ?? "client";
  if (options.json) {
    return JSON.stringify({ ...error.toJSON(), app });
  }
  const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ").trim();
  const remedy = error.remedy ? ` ${oneLine(error.remedy)}` : "";
  return `${app}: ${error.code}: ${oneLine(error.message)}${remedy}`;
}
