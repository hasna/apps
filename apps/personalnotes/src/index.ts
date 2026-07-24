/**
 * @hasna/personalnotes — OSS core public API (multi-tenancy backend surface).
 *
 * This barrel exposes the auth/tenancy backend: the AuthService, storage
 * adapters (SQLite + PostgreSQL), domain types, config, and the HTTP app
 * factory. Other OSS-core workstreams (notes CRUD, CLI, MCP) build alongside.
 */

export { AuthService } from "./lib/auth/service.js";
export type { AuthResult, RegisterInput, IssuedToken } from "./lib/auth/service.js";

export { hashPassword, verifyPassword, validatePasswordStrength } from "./lib/auth/passwords.js";
export {
  generateToken,
  hashToken,
  tokenKindOf,
  extractBearer,
  SESSION_TOKEN_PREFIX,
  API_TOKEN_PREFIX,
} from "./lib/auth/tokens.js";

export { AuthError, isAuthError } from "./lib/errors.js";
export type { AuthErrorCode } from "./lib/errors.js";

export {
  resolveConfig,
  defaultSqlitePath,
  DEFAULT_SUPER_ADMIN_EMAIL,
  ENV_PREFIX,
  ALIAS_ENV_PREFIX,
  DEPLOYMENT_MODES,
} from "./lib/config.js";
export type { BackendConfig, DeploymentMode } from "./lib/config.js";

export { createAuthStorage, SqliteAuthStorage, PostgresAuthStorage } from "./lib/storage/index.js";
export type { AuthStorage } from "./lib/storage/contract.js";

export { createApp } from "./server/app.js";
export type { App, AppOptions } from "./server/app.js";

export { toPublicUser, TENANT_ROLES } from "./lib/tenancy/types.js";
export type {
  Tenant,
  TenantStatus,
  TenantRole,
  User,
  UserStatus,
  PublicUser,
  Token,
  TokenKind,
  AuthContext,
} from "./lib/tenancy/types.js";

export { PACKAGE_VERSION } from "./lib/version.js";
