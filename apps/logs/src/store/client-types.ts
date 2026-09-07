/**
 * @hasna/logs — local spellings of the @hasna/contracts client types that
 * cross the published boundary.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * @hasna/contracts is a BUILD-TIME devDependency: `bun build --target bun`
 * inlines the resolver, but the declarations `tsc` emits are not bundled, so
 * a public exported signature that names a @hasna/contracts type would land
 * in `dist/**​/*.d.ts` as a live `@hasna/contracts` import and break every TS
 * consumer, which installs this package's runtime dependencies and not its
 * devDependencies (hasna/apps#1782 — the same rule the secrets/client-types
 * seam follows).
 *
 * The spellings here are structural mirrors of the published declarations;
 * `client-types.test.ts` asserts identity in both directions so they cannot
 * drift apart silently.
 */

/** Local mirror of `@hasna/contracts/client` KeychainTierOptions. */
export interface LogsKeychainTierOptions {
  enabled?: boolean;
  platform?: string;
  hostname?: () => string;
  run?: (
    argv: readonly string[],
  ) => { status: number | null; stdout: string; stderr: string };
}

/** Local mirror of `@hasna/contracts/client` CredentialChainOptions. */
export interface LogsCredentialChainOptions {
  apiKey?: string;
  profile?: string;
  keychain?: LogsKeychainTierOptions;
}

/** Local mirror of `@hasna/contracts/client` CredentialTier. */
export type LogsCredentialTier =
  | "argument"
  | "override"
  | "pointer"
  | "profile"
  | "keychain"
  | "disk"
  | "env";

/** Local mirror of `@hasna/contracts/client/storage` StorageListResult. */
export interface LogsStorageListResult<T> {
  items: T[];
  total: number | null;
  cursor: string | null;
  raw: unknown;
}

/**
 * Local mirror of the `HasnaStorageClient` surface the public {@link ApiStore}
 * constructor accepts. Structurally identical to the @hasna/contracts
 * declaration (asserted by `client-types.test.ts`), so a caller holding the
 * real storage client passes it unchanged.
 */
export interface LogsStorageClientLike {
  /** App slug this client targets. */
  readonly name: string;
  /** `<origin>/v1` base URL. */
  readonly baseUrl: string;
  /** The underlying HTTP transport (escape hatch for non-CRUD routes). */
  readonly transport: {
    request<T = unknown>(
      method: string,
      path: string,
      body?: unknown,
      opts?: {
        query?: unknown;
        idempotencyKey?: string;
        timeoutMs?: number;
        headers?: Record<string, string>;
        retry?: unknown;
        signal?: AbortSignal;
      },
    ): Promise<T>;
  };
  list<T = unknown>(
    resource: string,
    options?: {
      query?: unknown;
      timeoutMs?: number;
      headers?: Record<string, string>;
      retry?: unknown;
      signal?: AbortSignal;
    },
  ): Promise<LogsStorageListResult<T>>;
  get<T = unknown>(
    resource: string,
    id: string,
    options?: {
      query?: unknown;
      timeoutMs?: number;
      headers?: Record<string, string>;
      retry?: unknown;
      signal?: AbortSignal;
    },
  ): Promise<T | null>;
  create<T = unknown>(
    resource: string,
    body: unknown,
    options?: {
      query?: unknown;
      idempotencyKey?: string;
      timeoutMs?: number;
      headers?: Record<string, string>;
      retry?: unknown;
      signal?: AbortSignal;
    },
  ): Promise<T>;
}