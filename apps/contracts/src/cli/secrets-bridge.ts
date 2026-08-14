// Runtime-typed boundary to the @hasna/secrets SDK.
//
// WHY THIS FILE EXISTS — the mono install gate (P1-1 class). contracts' own
// `prepare: bun run build` runs inside `bun install`, when sibling members'
// built output does not exist yet: @hasna/secrets is a workspace member whose
// range (^0.2.22) matches the member version, so bun links the member instead
// of the registry copy, and the member's `dist/` is absent at install time.
// Turbo's topological build order (`build` with `dependsOn: ^build`) fixes
// that for BUILD time, but nothing builds the sibling during install — so the
// prepare step itself must never resolve the sibling's dist. A static import
// of "@hasna/secrets" would be resolved by tsc (TS7016, no declaration file)
// and by `bun build` ("Could not resolve") whenever the sibling's dist is
// absent, which is exactly the fresh-install state. This module keeps the
// real runtime import while removing the package specifier from every
// compile-time resolution surface.
//
// HOW IT WORKS. The specifier is assembled at runtime (`"@hasna/" + "secrets"`),
// so tsc cannot statically resolve it (non-literal dynamic-import arguments
// are never module-resolved — no TS7016) and `bun build` leaves the import in
// the emitted bundle as a runtime import (verified on bun 1.3.14: the bundle
// keeps `const spec = ...; await import(spec)`). The import therefore only
// materialises when `issue-key --secrets-ref` actually runs — the one command
// that needs the SDK — and resolves through the real package then: in the
// mono after turbo has built the member, in the published tarball via the
// declared `@hasna/secrets` dependency.
//
// THE TYPES ARE THE SDK'S OWN SHAPES, COPIED, NOT STUBS. The structural
// interfaces below are copied from the SDK's public client surface
// (apps/secrets/src/sdk/client.ts — SecretMetadata, SecretInput,
// SecretsClientOptions, and the SecretsClient method signatures) and the
// loader's call shape mirrors `createSecretsClientFromEnv`. Nothing here is
// invented: the boundary is a deliberate, documented seam whose runtime
// contract is exercised by the same code paths the static import served.

export interface SecretMetadata {
  key: string;
  type: "api_key" | "password" | "token" | "credential" | "other";
  label?: string | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecretInput {
  key: string;
  value: string;
  type?: "api_key" | "password" | "token" | "credential" | "other";
  label?: string;
  ttl?: string;
}

export interface SecretsBridgeClientOptions {
  baseUrl: string;
  apiKey?: string;
}

export interface SecretsBridgeClient {
  listSecrets(query?: { namespace?: string }): Promise<{ secrets?: SecretMetadata[] }>;
  putSecret(body: SecretInput): Promise<SecretMetadata>;
  deleteSecret(query?: { key: string }): Promise<Record<string, unknown>>;
}

/** The runtime-loaded module shape of `@hasna/secrets` used by this CLI. */
interface SecretsBridgeModule {
  createSecretsClientFromEnv(
    env: Record<string, string | undefined>,
    overrides: Partial<SecretsBridgeClientOptions>,
  ): SecretsBridgeClient;
}

/** Non-literal by design — see the header comment; never inline the string. */
const SECRETS_PACKAGE_SPECIFIER = "@hasna/" + "secrets";

/**
 * Build a Secrets client from explicit configuration only. Empty env plus
 * explicit overrides prevents the SDK's legacy-first ambient resolver from
 * selecting a different URL/key pair after validation (the caller has already
 * collapsed the canonical and legacy aliases into one authority).
 */
export async function createSecretsBridgeClient(
  options: SecretsBridgeClientOptions,
): Promise<SecretsBridgeClient> {
  const mod = (await import(SECRETS_PACKAGE_SPECIFIER)) as SecretsBridgeModule;
  return mod.createSecretsClientFromEnv({}, options);
}
