/** Typed errors for the auth/tenancy backend. `status` maps directly to HTTP. */

export type AuthErrorCode =
  | "invalid_request"
  | "email_taken"
  | "slug_taken"
  | "invalid_credentials"
  | "unauthenticated"
  | "forbidden"
  | "tenant_suspended"
  | "user_suspended"
  | "not_found";

const STATUS: Record<AuthErrorCode, number> = {
  invalid_request: 400,
  email_taken: 409,
  slug_taken: 409,
  invalid_credentials: 401,
  unauthenticated: 401,
  forbidden: 403,
  tenant_suspended: 403,
  user_suspended: 403,
  not_found: 404,
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;
  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isAuthError(err: unknown): err is AuthError {
  return err instanceof AuthError;
}
