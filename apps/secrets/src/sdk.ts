/**
 * @hasna/secrets — typed client for the secrets serve API.
 * Also available from the compatibility subpath @hasna/secrets/sdk.
 *
 * The method surface mirrors the serve OpenAPI document (src/server/openapi.ts)
 * and routes through the one shared Hasna HTTP transport (no raw fetch).
 *
 * CREDENTIALS AND AUTHORITY come from the @hasna/contracts client resolver — the
 * same five tiers the CLI and the MCP server use, resolved fresh on every
 * request (hasna/apps#1720). The SDK has NO env reading of its own any more; in
 * particular the old `SECRETS_API_URL` / `SECRETS_API_KEY` reads that SHADOWED
 * the canonical `HASNA_SECRETS_*` names are gone. Those two names survive only
 * as a silent alias inside the shared resolver, for one release.
 */

export * from "./sdk/client.js";
import { resolveClientTransport, resolveCredential } from "./store/client.js";
import type { CredentialChainOptions, ResolvedCredential } from "./store/client-types.js";
import { SecretsClient, type SecretsClientOptions } from "./sdk/client.js";

/**
 * Build a client from the environment through the shared credential resolver.
 *
 * Precedence (fresh on every request): an explicit `apiKey`/`profile` argument,
 * then `HASNA_SECRETS_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
 * `HASNA_SECRETS_API_KEY_REF`, then the macOS Keychain item
 * `hasna.credentials.secrets.api-key`, then `~/.hasna/secrets/config/credentials`,
 * then `HASNA_SECRETS_API_KEY`. The base URL follows `HASNA_SECRETS_API_URL`,
 * the Keychain `api-url` item, the credentials file, and otherwise defaults to
 * the fleet gateway `https://api.hasna.com/secrets`.
 *
 * THROWS when no credential resolves. A client that cannot authenticate is
 * never built, and never falls back to local data.
 *
 * An explicit `baseUrl` is a deliberate selection of an authority, and it
 * REQUIRES an explicit `apiKey` (hasna/apps#1794): the ambient fleet credential
 * — the Keychain item, the credentials file, `HASNA_SECRETS_API_KEY` — is
 * pinned to the authority it resolved with and is never attached to a
 * caller-supplied one. That case throws BEFORE any resolver tier is consulted,
 * so no Keychain read and no request happen on the way to the error.
 */
export function createSecretsClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<SecretsClientOptions> & { credentials?: CredentialChainOptions } = {},
): SecretsClient {
  const { credentials, ...clientOverrides } = overrides;
  if (clientOverrides.baseUrl !== undefined) {
    // Tier 1 in both shapes: the client option, or the resolver's own
    // `credentials.apiKey` argument. Either is a key the caller pinned in code.
    const pinnedKey = clientOverrides.apiKey ?? credentials?.apiKey;
    if (pinnedKey === undefined || pinnedKey === "") {
      throw new Error(
        "createSecretsClientFromEnv: an explicit baseUrl requires an explicit apiKey; the ambient " +
          "credential (Keychain hasna.credentials.secrets.api-key, ~/.hasna/secrets/config/credentials, " +
          "HASNA_SECRETS_API_KEY) is never sent to a caller-supplied authority (hasna/apps#1794).",
      );
    }
    return new SecretsClient({ ...clientOverrides, baseUrl: clientOverrides.baseUrl, apiKey: pinnedKey });
  }

  const clientEnv = env as Record<string, string | undefined>;
  const resolverOptions = credentials ? { credentials } : {};
  // The transport resolution validates the authority AND proves a credential
  // exists (it throws otherwise) before any client is handed back.
  const resolution = resolveClientTransport("secrets", clientEnv, resolverOptions);
  // `resolution.baseUrl` is the canonical `<origin>/v1` request root, which is
  // exactly the base the client's transport binds to (see ./sdk/client.ts).
  const baseUrl = resolution.baseUrl;

  // A PROVIDER, not a snapshot: a long-lived process picks up a key rotation
  // without being rebuilt, and the pointer tier is completed per request by the
  // shared transport.
  const apiKey =
    clientOverrides.apiKey ??
    ((): ResolvedCredential => {
      const resolved = resolveCredential("secrets", clientEnv, credentials);
      if (!resolved) {
        throw new Error(
          "createSecretsClientFromEnv: no @hasna/secrets credential resolved (Keychain, " +
            "~/.hasna/secrets/config/credentials, HASNA_SECRETS_API_KEY).",
        );
      }
      return resolved;
    });

  return new SecretsClient({ ...clientOverrides, baseUrl, apiKey });
}
