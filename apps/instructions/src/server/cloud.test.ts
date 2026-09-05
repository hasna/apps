// Agent-authored (SOL consult refused: "Selected model is at capacity. Please try a different model.").
//
// The cloud env-resolution functions pick the /v1 backend wiring from env.
// The priority order is the contract: the app-prefixed variable must win over
// the generic DATABASE_URL, and a retired storage-mode variable must make the
// whole resolution FAIL LOUD rather than silently select a store. A reversed
// priority or a swallowed legacy key would point the serve process at the
// wrong database while reporting healthy.
import net from "node:net";
import { describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey, type ApiKeyStatus } from "@hasna/contracts/auth";
import {
  INSTRUCTIONS_APP_SLUG,
  closeCloud,
  ensureCloudSchema,
  getCloudVerifier,
  getHonoAuthMiddleware,
  isPostgresBackendEnabled,
  resolveCloudDatabaseUrl,
  resolveSigningSecret,
} from "./cloud";

describe("resolveCloudDatabaseUrl", () => {
  test("prefers the app-scoped variable over the generic ones", () => {
    const url = resolveCloudDatabaseUrl({
      HASNA_INSTRUCTIONS_DATABASE_URL: "postgres://app",
      INSTRUCTIONS_DATABASE_URL: "postgres://legacy",
      DATABASE_URL: "postgres://generic",
    });
    expect(url).toBe("postgres://app");
  });

  test("falls back to INSTRUCTIONS_DATABASE_URL then DATABASE_URL", () => {
    expect(
      resolveCloudDatabaseUrl({ INSTRUCTIONS_DATABASE_URL: "postgres://legacy", DATABASE_URL: "postgres://generic" }),
    ).toBe("postgres://legacy");
    expect(resolveCloudDatabaseUrl({ DATABASE_URL: "postgres://generic" })).toBe("postgres://generic");
  });

  test("returns undefined when no database URL is configured", () => {
    expect(resolveCloudDatabaseUrl({})).toBeUndefined();
  });

  test("FAIL-LOUD: any retired storage-mode variable aborts resolution", () => {
    for (const key of ["HASNA_INSTRUCTIONS_STORAGE_MODE", "INSTRUCTIONS_MODE"] as const) {
      expect(() => resolveCloudDatabaseUrl({ [key]: "cloud", DATABASE_URL: "postgres://x" }), key).toThrow(
        /was removed/,
      );
    }
  });
});

describe("resolveSigningSecret", () => {
  test("prefers the app-scoped key, then the shared hasna key, then the generic secret", () => {
    expect(
      resolveSigningSecret({
        HASNA_INSTRUCTIONS_API_SIGNING_KEY: "app-key",
        HASNA_API_SIGNING_KEY: "shared-key",
        API_KEY_SIGNING_SECRET: "generic-key",
      }),
    ).toBe("app-key");
    expect(resolveSigningSecret({ HASNA_API_SIGNING_KEY: "shared-key", API_KEY_SIGNING_SECRET: "generic-key" })).toBe(
      "shared-key",
    );
    expect(resolveSigningSecret({ API_KEY_SIGNING_SECRET: "generic-key" })).toBe("generic-key");
  });

  test("returns undefined when no signing secret is configured", () => {
    expect(resolveSigningSecret({})).toBeUndefined();
  });

  test("trims a trailing newline from a stored signing secret (hasna/apps#1543)", () => {
    // The fleet stores api-key-signing-secret values with a trailing newline
    // (64 hex chars + '\n'); the server verify path must key the HMAC with the
    // same bytes issue-key signs with, so every candidate is trimmed at read.
    const stored = "a1".repeat(32) + "\n";
    expect(resolveSigningSecret({ HASNA_INSTRUCTIONS_API_SIGNING_KEY: stored })).toBe(stored.trim());
    expect(resolveSigningSecret({ HASNA_API_SIGNING_KEY: stored })).toBe(stored.trim());
    expect(resolveSigningSecret({ API_KEY_SIGNING_SECRET: stored })).toBe(stored.trim());
  });
});

describe("isPostgresBackendEnabled", () => {
  test("true when any supported database URL is present", () => {
    expect(isPostgresBackendEnabled({ HASNA_INSTRUCTIONS_DATABASE_URL: "postgres://x" })).toBe(true);
    expect(isPostgresBackendEnabled({ DATABASE_URL: "postgres://x" })).toBe(true);
  });

  test("false when none is present", () => {
    expect(isPostgresBackendEnabled({})).toBe(false);
  });
});

describe("INSTRUCTIONS_APP_SLUG", () => {
  test("is the stable route slug used by the serving contract", () => {
    expect(INSTRUCTIONS_APP_SLUG).toBe("instructions");
  });
});

// ── keyStatus wiring regression (row 67e30a56, incidents 720505/720506) ───────
// The contracts auth verifier fails CLOSED at construction when wired with
// `isRevoked` only: isRevoked cannot refuse a key this service has no record
// of (false for both an active key and one never registered), so an
// unregistered key is irrevocable. That made the whole /v1 API 503 — the
// station01 instruction-delivery check PLAN-FAILED and `instructions list`
// exited rc=1. The construction tests below prove BOTH /v1 auth construction
// sites in cloud.ts wire the recommended `keyStatus` hook
// (`ApiKeyStore.keyStatus` from @hasna/contracts/auth); the hook tests prove
// the hook is consulted, not dead code: revoked keys are denied, active keys
// accepted, and an unregistered (unknown) key is refused — the exact property
// the isRevoked-only wiring could not provide.
const REPRO_DB_URL = "postgresql://repro:repro@127.0.0.1:1/repro";
const REPRO_SIGNING = "repro-signing-secret-not-a-real-secret";

function withCloudEnv(fn: () => void): void {
  const hadUrl = Object.prototype.hasOwnProperty.call(process.env, "HASNA_INSTRUCTIONS_DATABASE_URL");
  const hadSecret = Object.prototype.hasOwnProperty.call(process.env, "HASNA_INSTRUCTIONS_API_SIGNING_KEY");
  const oldUrl = process.env.HASNA_INSTRUCTIONS_DATABASE_URL;
  const oldSecret = process.env.HASNA_INSTRUCTIONS_API_SIGNING_KEY;
  process.env.HASNA_INSTRUCTIONS_DATABASE_URL = REPRO_DB_URL;
  process.env.HASNA_INSTRUCTIONS_API_SIGNING_KEY = REPRO_SIGNING;
  try {
    fn();
  } finally {
    if (hadUrl) process.env.HASNA_INSTRUCTIONS_DATABASE_URL = oldUrl;
    else delete process.env.HASNA_INSTRUCTIONS_DATABASE_URL;
    if (hadSecret) process.env.HASNA_INSTRUCTIONS_API_SIGNING_KEY = oldSecret;
    else delete process.env.HASNA_INSTRUCTIONS_API_SIGNING_KEY;
  }
}

describe("cloud /v1 auth keyStatus wiring", () => {
  test("getCloudVerifier() constructs with the keyStatus hook (not isRevoked-only)", () => {
    withCloudEnv(() => {
      const verifier = getCloudVerifier();
      expect(verifier.app).toBe(INSTRUCTIONS_APP_SLUG);
    });
  });

  test("getHonoAuthMiddleware() constructs with the keyStatus hook", () => {
    withCloudEnv(() => {
      const mw = getHonoAuthMiddleware(["instructions:read"]);
      expect(typeof mw).toBe("function");
    });
  });

  test("a revoked key is denied through the key-status hook (401)", async () => {
    const { token } = mintApiKey({ app: "instructions", scopes: ["instructions:read"], signingSecret: REPRO_SIGNING });
    const verifier = verifyApiKey({
      app: "instructions",
      signingSecret: REPRO_SIGNING,
      keyStatus: async (): Promise<ApiKeyStatus> => "revoked",
    });
    const decision = await verifier.authenticate({ "x-api-key": token }, { requiredScopes: ["instructions:read"] });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.status).toBe(401);
  });

  test("an active key is accepted through the key-status hook (200)", async () => {
    const { token } = mintApiKey({ app: "instructions", scopes: ["instructions:read"], signingSecret: REPRO_SIGNING });
    const verifier = verifyApiKey({
      app: "instructions",
      signingSecret: REPRO_SIGNING,
      keyStatus: async (): Promise<ApiKeyStatus> => "active",
    });
    const decision = await verifier.authenticate({ "x-api-key": token }, { requiredScopes: ["instructions:read"] });
    expect(decision.ok).toBe(true);
  });

  test("an unregistered (unknown) key is refused — the class isRevoked-only wiring could not cover", async () => {
    const { token } = mintApiKey({ app: "instructions", scopes: ["instructions:read"], signingSecret: REPRO_SIGNING });
    const verifier = verifyApiKey({
      app: "instructions",
      signingSecret: REPRO_SIGNING,
      keyStatus: async (): Promise<ApiKeyStatus> => "unknown",
    });
    const decision = await verifier.authenticate({ "x-api-key": token }, { requiredScopes: ["instructions:read"] });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.status).toBe(401);
  });
});

// ── schema-ensure rejection recovery (row 6f6fdf2b) ──────────────────────────
// ensureCloudSchema caches its in-flight promise at module level and replays it
// on every later call (`if (schemaEnsured) return schemaEnsured`). A REJECTED
// promise was cached forever: one transient Postgres failure at the first
// authenticated /v1 request made every later request 503 ("database
// unavailable") until process restart. closeCloud() could clear the cache, but
// the serving process never calls it — the only call site is the `migrate` CLI
// branch, which exits.
//
// The discriminator is the CONNECTION COUNT: the module's client pool is
// deliberately persistent (like production), so only a genuine re-attempt
// reaches the network. A counting TCP server that accepts and destroys sockets
// fails the pg handshake fast through the connect-error path (no pool-level
// 'error' events, no unhandled rejection).
describe("ensureCloudSchema failure recovery (row 6f6fdf2b)", () => {
  test("clears a rejected schema-ensure so the next call re-attempts", async () => {
    // Isolate: earlier tests in this file may have created the module's pool.
    await closeCloud();

    const connections: string[] = [];
    const server = net.createServer((socket) => {
      connections.push("accepted");
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;

    const hadUrl = Object.prototype.hasOwnProperty.call(process.env, "HASNA_INSTRUCTIONS_DATABASE_URL");
    const oldUrl = process.env.HASNA_INSTRUCTIONS_DATABASE_URL;
    process.env.HASNA_INSTRUCTIONS_DATABASE_URL = `postgresql://repro:repro@127.0.0.1:${port}/repro`;
    try {
      await expect(ensureCloudSchema()).rejects.toThrow();
      expect(connections.length).toBe(1); // positive control: the attempt reached the network

      // With the bug the cached rejection is replayed and the server sees no
      // second connection; with the fix the cache is cleared and a fresh
      // attempt lands. Assert the re-attempt, not the error message.
      await expect(ensureCloudSchema()).rejects.toThrow();
      expect(connections.length).toBe(2);
    } finally {
      await closeCloud();
      server.close();
      if (hadUrl) process.env.HASNA_INSTRUCTIONS_DATABASE_URL = oldUrl;
      else delete process.env.HASNA_INSTRUCTIONS_DATABASE_URL;
    }
  });
});
